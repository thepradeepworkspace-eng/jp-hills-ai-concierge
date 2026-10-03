import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'hotel-config.json'), 'utf8'));
const widgetHtml = fs.readFileSync(path.join(__dirname, 'concierge-ui.html'), 'utf8');
const PORT = Number(process.env.PORT || 8787);
const MCP_PATH = '/mcp';
const TEMPLATE_URI = 'ui://jp-hills/concierge-v1.html';
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_ORIGIN = 'https://jp-hills-ai-concierge.onrender.com';

function sendHtml(res, fileName, status = 200) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}).end('Not Found');
    return;
  }
  res.writeHead(status, {
    'content-type':'text/html; charset=utf-8',
    'cache-control':'public, max-age=300'
  });
  res.end(fs.readFileSync(filePath));
}


function textResult(text, structuredContent = {}) {
  return { structuredContent, content: [{ type: 'text', text }] };
}

function clean(value, max = 800) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function ticket(prefix = 'JP') {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function priorityFor(service, details = '') {
  const t = `${service} ${details}`.toLowerCase();
  if (/fire|smoke|medical|blood|unconscious|electric shock|gas leak|danger/.test(t)) return 'Emergency';
  if (/manager|maintenance|ac |air condition|lock|no water|toilet|bathroom/.test(t)) return 'High';
  if (/clean|towel|amenit|late_checkout|late checkout/.test(t)) return 'Normal';
  return 'Normal';
}

async function sendHotelEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.HOTEL_ALERT_EMAIL;
  const from = process.env.FROM_EMAIL;
  if (!apiKey || !to || !from) {
    console.log('[EMAIL NOT CONFIGURED]', subject, html.replace(/<[^>]+>/g, ' '));
    return { sent: false, mode: 'console' };
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  if (!resp.ok) throw new Error(`Email provider error ${resp.status}`);
  const data = await resp.json();
  return { sent: true, id: data.id || '' };
}

async function forwardWebhook(payload) {
  const url = process.env.REQUEST_WEBHOOK_URL;
  if (!url) return { sent: false };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(`Webhook error ${resp.status}`);
  return { sent: true };
}

function emailLayout(title, rows, note = '') {
  const tr = rows.map(([k, v]) => `<tr><td style="padding:8px 12px;color:#64748b;font-size:12px;border-bottom:1px solid #eef2f7">${escapeHtml(k)}</td><td style="padding:8px 12px;font-weight:700;border-bottom:1px solid #eef2f7">${escapeHtml(v)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:22px;color:#17202a"><div style="font-size:12px;color:#a27b2e;font-weight:800;letter-spacing:1.2px">JP HILLS AI CONCIERGE</div><h2 style="margin:8px 0 16px">${escapeHtml(title)}</h2><table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eef2f7;border-radius:12px">${tr}</table>${note ? `<p style="font-size:12px;color:#64748b;margin-top:16px">${escapeHtml(note)}</p>` : ''}</div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function liveConfig() {
  return {
    ...config,
    brandName: process.env.HOTEL_BRAND_NAME || config.brandName,
    wifi: {
      ...config.wifi,
      password: process.env.HOTEL_WIFI_PASSWORD || config.wifi.password
    }
  };
}

function publicConfig(room = '', source = 'ChatGPT') {
  return {
    ...liveConfig(),
    room: clean(room, 20),
    source: clean(source, 80)
  };
}

function createServer() {
  const server = new McpServer(
    { name: 'jp-hills-ai-concierge', version: '1.0.0' },
    { instructions: 'JP Hills guest concierge. Use show_concierge_home for the visual card menu. Never claim a hotel request is sent unless the relevant write tool returns ok=true. Ask for explicit confirmation before sharing guest-provided request details with the hotel unless the guest pressed a UI Send button, which is confirmation. Late checkout and bookings are requests, never guaranteed approvals.' }
  );

  server.registerResource('jp-hills-concierge-ui', TEMPLATE_URI, {}, async () => ({
    contents: [{
      uri: TEMPLATE_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: widgetHtml,
      _meta: { ui: { prefersBorder: false, domain: APP_ORIGIN, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } } }
    }]
  }));

  server.registerTool('show_concierge_home', {
    title: 'Open JP Hills Guest Concierge',
    description: 'Show the JP Hills visual guest concierge home with tappable cards for Wi-Fi, breakfast, housekeeping, towels, rooftop, rafting, Kunjapuri, food menu, late checkout, feedback, manager and other requests. Use this first when a guest opens the concierge.',
    inputSchema: {
      room: z.string().max(20).optional().describe('Known room number from the guest or room-specific QR context.'),
      source: z.string().max(80).optional().describe('QR/source label, e.g. Room QR, Restaurant QR, Pool QR.')
    },
    outputSchema: {
      brandName: z.string(),
      room: z.string(),
      source: z.string(),
      welcome: z.string(),
      wifi: z.any(), breakfast: z.any(), rooftop: z.any(), lateCheckout: z.any(), activities: z.any(), menu: z.any(), services: z.any()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: TEMPLATE_URI },
      'openai/toolInvocation/invoking': 'Opening your concierge…',
      'openai/toolInvocation/invoked': 'Concierge ready.'
    }
  }, async ({ room = '', source = 'ChatGPT Guest Concierge' }) => {
    const data = publicConfig(room, source);
    return textResult(`JP Hills Guest Concierge is open${data.room ? ` for room ${data.room}` : ''}. The guest can tap a card or continue by chatting.`, data);
  });

  server.registerTool('get_hotel_info', {
    title: 'Get hotel guest information',
    description: 'Read current hotel information for Wi-Fi, breakfast, rooftop, pool, check-in, checkout or food menu when the guest asks in conversation.',
    inputSchema: { topic: z.enum(['wifi','breakfast','rooftop','pool','checkin','checkout','menu']) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async ({ topic }) => {
    const c = liveConfig();
    const map = {
      wifi: c.wifi,
      breakfast: c.breakfast,
      rooftop: c.rooftop,
      pool: c.pool,
      checkin: { time: c.checkin },
      checkout: { time: c.checkout },
      menu: c.menu
    };
    return textResult(`Hotel information for ${topic}.`, { topic, data: map[topic] });
  });

  server.registerTool('create_service_request', {
    title: 'Send guest service request',
    description: 'Send a confirmed guest request to Hotel JP Hills. Use for housekeeping, towels/amenities, late checkout, manager contact or other hotel assistance. Never use before the guest has confirmed sharing the request with the hotel.',
    inputSchema: {
      service: z.enum(['cleaning','towels','late_checkout','manager','other']),
      room: z.string().min(1).max(20),
      details: z.string().min(1).max(1200),
      source: z.string().max(80).optional(),
      consent_to_share: z.boolean()
    },
    outputSchema: { ok: z.boolean(), ticketId: z.string(), priority: z.string(), emailed: z.boolean(), message: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }, async (args) => {
    if (!args.consent_to_share) throw new Error('Guest confirmation is required before sending this request.');
    const id = ticket('JP');
    const priority = priorityFor(args.service, args.details);
    const payload = {
      kind: 'service_request', ticketId: id, createdAt: new Date().toISOString(), service: args.service,
      room: clean(args.room,20), details: clean(args.details,1200), source: clean(args.source || 'ChatGPT Guest Concierge',80), priority
    };
    const email = await sendHotelEmail({
      subject: `[${priority}] ${id} ´ Room ${payload.room} ´ ${payload.service.replace('_',' ')}`,
      html: emailLayout('New guest service request', [
        ['Ticket', id], ['Room', payload.room], ['Service', payload.service.replace('_',' ')], ['Priority', priority], ['Details', payload.details], ['Source', payload.source], ['Time', payload.createdAt]
      ], 'Sent from JP Hills AI Concierge after guest confirmation.')
    });
    const webhook = await forwardWebhook(payload).catch(err => { console.error(err); return { sent:false }; });
    const delivered = !!(email.sent || webhook.sent);
    if (!delivered) return textResult(`Request ${id} could not be delivered to the hotel system. Please contact reception directly.`, { ok:false, ticketId:id, priority, emailed:false, message:'Request was not delivered. Please contact reception directly.' });
    return textResult(`Request ${id} was sent to the hotel team for room ${payload.room}. This is a request, not a guarantee of completion or approval.`, { ok:true, ticketId:id, priority, emailed:email.sent, message:'Request sent to the hotel team.' });
  });

  server.registerTool('create_activity_request', {
    title: 'Send activity booking enquiry',
    description: 'Send a confirmed rafting or Kunjapuri booking enquiry to the hotel/travel desk. This creates an enquiry only; never claim the activity is booked until the hotel confirms.',
    inputSchema: {
      activity: z.enum(['rafting','kunjapuri']), room: z.string().min(1).max(20), details: z.string().min(1).max(1200), source: z.string().max(80).optional(), consent_to_share: z.boolean()
    },
    outputSchema: { ok:z.boolean(), ticketId:z.string(), emailed:z.boolean(), message:z.string() },
    annotations: { readOnlyHint:false, destructiveHint:true, openWorldHint:true }
  }, async (args) => {
    if (!args.consent_to_share) throw new Error('Guest confirmation is required before sending this enquiry.');
    const id = ticket('TRV');
    const payload = { kind:'activity_request', ticketId:id, createdAt:new Date().toISOString(), activity:args.activity, room:clean(args.room,20), details:clean(args.details,1200), source:clean(args.source||'ChatGPT Guest Concierge',80) };
    const email = await sendHotelEmail({ subject:`[Travel Desk] ${id} · Room ${payload.room} · ${payload.activity}`, html:emailLayout('New travel/activity enquiry', [['Ticket',id],['Room',payload.room],['Activity',payload.activity],['Details',payload.details],['Source',payload.source],['Time',payload.createdAt]], 'This is an enquiry only. Confirm availability and pricing directly with the guest.') });
    const webhook = await forwardWebhook(payload).catch(err => { console.error(err); return { sent:false }; });
    const delivered = !!(email.sent || webhook.sent);
    if (!delivered) return textResult(`Activity enquiry ${id} could not be delivered to the hotel system. Please contact reception or the travel desk directly.`, {ok:false,ticketId:id,emailed:false,message:'Booking enquiry was not delivered.'});
    return textResult(`Activity enquiry ${id} was sent to the hotel/travel desk. Availability and price still require confirmation.`, {ok:true,ticketId:id,emailed:email.sent,message:'Booking enquiry sent for confirmation.'});
  });

  server.registerTool('submit_guest_feedback', {
    title: 'Send guest feedback',
    description: 'Send guest feedback to Hotel JP Hills after the guest explicitly chooses to submit it.',
    inputSchema: {
      rating: z.number().int().min(1).max(5), comment: z.string().min(1).max(2500), room: z.string().max(20).optional(), source: z.string().max(80).optional(),
      contact_requested: z.boolean().optional(), consent_to_share: z.boolean()
    },
    outputSchema: { ok:z.boolean(), ticketId:z.string(), priority:z.string(), emailed:z.boolean(), message:z.string() },
    annotations: { readOnlyHint:false, destructiveHint:true, openWorldHint:true }
  }, async (args) => {
    if (!args.consent_to_share) throw new Error('Guest confirmation is required before sending feedback.');
    const id = ticket('FB');
    const priority = args.rating <= 2 ? 'High' : args.rating === 3 ? 'Normal' : 'Positive';
    const payload = { kind:'feedback', ticketId:id, createdAt:new Date().toISOString(), rating:args.rating, comment:clean(args.comment,2500), room:clean(args.room,20), source:clean(args.source||'ChatGPT Guest Concierge',80), contactRequested:!!args.contact_requested, priority };
    const email = await sendHotelEmail({ subject:`[Feedback ${args.rating}/5] ${id}${payload.room?` · Room ${payload.room}`:''}`, html:emailLayout('New guest feedback', [['Ticket',id],['Rating',`${args.rating}/5`],['Room',payload.room||'Not provided'],['Feedback',payload.comment],['Contact requested',payload.contactRequested?'Yes':'No'],['Source',payload.source],['Time',payload.createdAt]]) });
    const webhook = await forwardWebhook(payload).catch(err => { console.error(err); return { sent:false }; });
    const delivered = !!(email.sent || webhook.sent);
    if (!delivered) return textResult(`Feedback ${id} could not be delivered to the hotel system. Please share it with reception directly.`, {ok:false,ticketId:id,priority,emailed:false,message:'Feedback was not delivered.'});
    return textResult(`Feedback ${id} was shared with Hotel JP Hills.`, {ok:true,ticketId:id,priority,emailed:email.sent,message:'Thank you. Your feedback has been shared with the hotel team.'});
  });

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id'
    });
    res.end(); return;
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({ok:true,name:'JP Hills AI Concierge',mcp:MCP_PATH})); return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({ok:true,time:new Date().toISOString()})); return;
  }
  if (req.method === 'GET' && url.pathname === '/privacy') { sendHtml(res, 'privacy.html'); return; }
  if (req.method === 'GET' && url.pathname === '/terms') { sendHtml(res, 'terms.html'); return; }
  if (req.method === 'GET' && url.pathname === '/support') { sendHtml(res, 'support.html'); return; }
  if (req.method === 'GET' && url.pathname === '/concierge') {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>JP Hills AI Concierge</title><style>body{font-family:system-ui;background:#0c1016;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.c{max-width:620px;padding:38px;background:#151b24;border:1px solid #2a3442;border-radius:24px}.g{color:#d7ad52;font-weight:800;letter-spacing:.08em}h1{font-size:40px;margin:10px 0 12px}p{color:#b8c0cc;line-height:1.6}code{color:#8ee6ff}</style></head><body><div class="c"><div class="g">HOTEL JP HILLS · RISHIKESH</div><h1>AI Guest Concierge</h1><p>This service runs inside ChatGPT. Hotel information and guest-service actions are provided by the JP Hills MCP plugin.</p><p>Status endpoint: <code>/health</code></p></div></body></html>`); return;
  }
  if (req.method === 'GET' && url.pathname === '/.well-known/openai-apps-challenge') {
    const token = String(process.env.OPENAI_APPS_CHALLENGE_TOKEN || '').trim();
    if (!token) { res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}).end('Challenge token not configured'); return; }
    res.writeHead(200, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}).end(token); return;
  }
  if (url.pathname === MCP_PATH && ['POST','GET','DELETE'].includes(req.method || '')) {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Expose-Headers','Mcp-Session-Id');
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req,res); }
    catch (err) { console.error(err); if(!res.headersSent) res.writeHead(500).end('Internal server error'); }
    return;
  }
  res.writeHead(404, {'content-type':'text/plain'}).end('Not Found');
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`JP Hills AI Concierge MCP listening on http://localhost:${PORT}${MCP_PATH}`));
