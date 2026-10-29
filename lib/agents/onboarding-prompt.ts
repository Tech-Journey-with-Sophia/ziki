import { OPEN_LINK_IF_YOU_CAN, WATCH_WORK_MESSAGE } from "@/lib/agents/pairing-link";

/**
 * The prompt a person pastes into Claude, Antigravity, Cursor, or another
 * agent so it can pair itself with their Ziki account. Approval stays with
 * the signed-in person; the agent never receives a key until they approve.
 */
export function agentOnboardingPrompt(origin: string): string {
  const site = origin.replace(/\/$/, "");
  return `You are connecting yourself to Ziki Issues (${site}) as an agent that works for me.

Ask me what I want to call you before you call the API. Also ask which model you are, such as Claude or GPT. Use my answers. Do not invent the name. You join as a working agent; a tenant admin can make you a manager or merger agent later.

Then pair yourself:

1. POST ${site}/api/v1/agents/pairing
   Content-Type: application/json
   {"name":"<the name I chose>","model":"<the model, or leave this field out>"}

   - Leave \`level\` out: every agent joins as a working agent.

2. The response gives you user_code, device_code, verification_uri, expires_at, and interval.
   Show me the user_code in large text and give me verification_uri_complete (or verification_uri).
   ${OPEN_LINK_IF_YOU_CAN} that link for me.
   Tell me to open that page while I am signed into the Ziki account that belongs to this organization, enter the code, and approve you.
   If that page asks which project, I must choose the project you will work in. The code lasts 15 minutes and works once.
   Then wait for my approval by polling in step 3. Do not invent an approval.

3. Poll until I have approved. Wait interval seconds between tries.
   POST ${site}/api/v1/agents/pairing/token
   Content-Type: application/json
   {"device_code":"<the device_code from step 1>"}
   - error authorization_pending: I have not approved yet. Keep waiting.
   - api_key: store that key. It is shown only this once. Confirm to me with the key_prefix only, not the full secret, unless I ask for the secret.
   - error expired_token: start again from step 1.
   - error used_token or invalid_grant: start again from step 1.

4. Check the key with GET ${site}/api/v1/agents/me and header Authorization: Bearer <api_key>.
   Tell me your agent id, name, level, and project.

5. Watch for work. ${WATCH_WORK_MESSAGE} Your work_url is in the response from step 4 (${site}/<project-slug>/work).
   Read ${site}/llms.txt and follow it for later work. Send the key only as Authorization: Bearer <api_key>. A project id is not the API key.`;
}
