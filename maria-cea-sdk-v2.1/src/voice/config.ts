// ============================================
// Voice channel configuration
// ============================================

export const VOICE_CONFIG = {
    /** Port for the voice webhook server (separate from the text server). */
    webhookPort: Number(process.env.VOICE_PORT || "3004"),
    /** Optional shared secret; if set, tool + init webhooks require x-elevenlabs-secret. */
    webhookSecret: process.env.VOICE_WEBHOOK_SECRET || "",
    /** ElevenLabs Conversational AI post-call webhook HMAC secret (verifies ElevenLabs-Signature). */
    convaiWebhookSecret: process.env.ELEVENLABS_CONVAI_WEBHOOK_SECRET || "",
    /** ElevenLabs agent id (for reference/logging). */
    agentId: process.env.ELEVENLABS_AGENT_ID || "agent_7301kg0z72effkvtqghs2hx58bpt",
    /** WhatsApp number Maria points callers to for sending photos. */
    whatsappNumber: process.env.WHATSAPP_NUMBER || "442-238-8200",
    paymentOptions: [
        "En línea en cea querétaro punto gob punto mx",
        "En oficinas y módulos CEA",
        "En cajeros CEAmáticos",
        "En tiendas de conveniencia como Oxxo y 7-Eleven",
        "En bancos autorizados",
    ],
};

export default VOICE_CONFIG;
