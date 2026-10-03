# JP Hills AI Concierge — Submission Notes

## App name
JP Hills AI Concierge

## Short description
AI guest concierge for Hotel JP Hills, Rishikesh. Guests can access Wi-Fi details, breakfast and rooftop timings, request housekeeping and amenities, ask about rafting or Kunjapuri, browse the food menu, request late checkout, submit feedback, or ask for manager assistance.

## Public MCP endpoint
https://jp-hills-ai-concierge.onrender.com/mcp

## Public policy/support pages
- Privacy: https://jp-hills-ai-concierge.onrender.com/privacy
- Terms: https://jp-hills-ai-concierge.onrender.com/terms
- Support: https://jp-hills-ai-concierge.onrender.com/support

## Primary test cases
1. Open the JP Hills concierge for room 204.
2. Ask for the hotel Wi-Fi details.
3. Request bathroom cleaning for room 204 and confirm sending it to the hotel.
4. Request 2 fresh towels for room 204 and confirm sending.
5. Ask for breakfast timing.
6. Ask when the rooftop café and live music are available.
7. Ask about rafting options, then create an enquiry only after confirmation.
8. Ask about the Kunjapuri sunrise trip, then create an enquiry only after confirmation.
9. Browse the food menu.
10. Ask for late checkout at 1 PM and confirm sending the request.
11. Submit 2/5 feedback with a comment and request manager contact.
12. Ask to talk to the manager.

## Expected behavior
- Read-only information should be returned without creating any external action.
- Service, activity, and feedback write tools require explicit guest confirmation.
- Late checkout and activity enquiries are requests only, never guaranteed approvals.
- If email/webhook delivery is not configured or fails, the tool must return ok=false and tell the guest to contact reception directly.
- The destination for hotel notifications is server-controlled; guests cannot choose arbitrary recipients.
- The app intentionally does not request or store payment card numbers, passwords, or government ID information.

## Pre-submission checklist
- [x] Stable HTTPS MCP endpoint
- [x] Privacy page
- [x] Terms page
- [x] Support page
- [x] Explicit confirmation for external actions
- [x] Tool annotations distinguish read-only vs external write actions
- [x] Room-specific context supported
- [x] Custom ChatGPT UI resource included
- [x] Hotel Wi-Fi password supplied via server environment variable rather than public source code
- [ ] Configure live notification delivery (Resend and/or webhook)
- [ ] Test confirmed service request end-to-end
- [ ] Test confirmed feedback end-to-end
- [ ] Finalize live food menu and prices
- [ ] Verify all guest-facing hotel timings
- [ ] Complete OpenAI submission form and domain verification when prompted
