# JP Hills AI Concierge — ChatGPT Plugin

A native ChatGPT guest concierge with a visual 2-column card interface. Guests can view Wi-Fi, breakfast and rooftop information, browse a food menu, request housekeeping/amenities/late checkout/manager assistance, ask about rafting or Kunjapuri, and submit feedback. Requests can be emailed to Hotel JP Hills and remain acknowledged in the same ChatGPT conversation.

## What is already built

- Native MCP App UI rendered inside ChatGPT (not an Apps Script page)
- 12 tappable concierge cards
- Detail panels for Wi-Fi, breakfast, rooftop and menu
- One-tap hotel service request flow when room context is known
- Activity enquiry flow
- Guest feedback form inside the ChatGPT component
- Email routing through Resend
- Optional CRM/webhook forwarding
- Ticket IDs and priority logic
- Guest-consent checks for write actions
- Hotel knowledge in `hotel-config.json`
- Public plugin package scaffold under `plugin-package/`

## 1. Configure hotel facts

Edit `hotel-config.json`. **Change the Wi-Fi password and sample food menu before production.**

## 2. Configure email

Copy `.env.example` values into your hosting provider's environment variables.

Required for live email:
- `RESEND_API_KEY`
- `FROM_EMAIL` (must use a verified sender/domain in Resend)
- `HOTEL_ALERT_EMAIL`

If these are not configured, the server logs the request instead of emailing it. This is intentional for safe local testing.

## 3. Run locally

```bash
npm install
npm start
```

Server: `http://localhost:8787/mcp`
Health: `http://localhost:8787/health`

Use MCP Inspector if desired:

```bash
npx @modelcontextprotocol/inspector@latest
```

## 4. Test in ChatGPT

ChatGPT's current plugin development flow requires a publicly reachable HTTPS MCP endpoint. During development you can expose port 8787 using a secure tunnel, then in ChatGPT enable Developer mode and add the HTTPS `/mcp` URL as a personal plugin.

Suggested test prompt:

> Open the JP Hills guest concierge for room 204.

The model should call `show_concierge_home` with `room: "204"`, then the cards render inside the conversation.

## 5. Deploy

Deploy this Node server to any stable HTTPS Node host (Render, Railway, Fly.io, Google Cloud Run, AWS, etc.). Set the environment variables in the host, then test the public `/mcp` endpoint.

Before public plugin submission:
1. Replace all `hotel-jp-hills.example` and `YOUR-MCP-DOMAIN.example` placeholders.
2. Host final website/support/privacy/terms pages over HTTPS.
3. Review the privacy/terms templates with your legal/business requirements.
4. Update `plugin-package/mcp.json` to your real MCP URL.
5. Replace the placeholder icon/logo with your official JP Hills branding if desired.
6. Zip the contents of `plugin-package/` and upload in the ChatGPT plugin submission flow.

## QR / room context

The plugin is ready to receive `room` and `source` in `show_concierge_home`. During testing, say “Open the JP Hills concierge for room 204.”

For production room-specific QR codes, first publish the plugin and obtain the final supported ChatGPT plugin/deep-link entry URL. Then map each room QR to that published entry. Do **not** invent or hard-code a ChatGPT deep-link format before publication because the supported link surface is assigned by ChatGPT/plugin publishing and can change.

Example room context expected by the tool:

```json
{"room":"204","source":"Room QR"}
```

## Important operational behavior

- `Send request` in the UI counts as explicit confirmation to share the displayed request with the hotel.
- Late checkout and travel requests are **requests/enquiries**, not approvals.
- The destination email is fixed server-side. Guests cannot choose arbitrary email recipients.
- The plugin does not need an OpenAI API key: ChatGPT supplies the intelligence; your MCP server only exposes hotel data/actions/UI.
