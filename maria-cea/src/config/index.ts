// ============================================
// Maria Claude - Config Exports
// ============================================

// Response Templates
export {
    // Types
    type FormatType,
    type TemplateField,
    type ResponseTemplate,
    type StatusDisplayItem,

    // Mappings
    STATUS_DISPLAY,
    CATEGORY_EMOJIS,
    TICKET_TYPE_EMOJIS,

    // Functions
    formatField,
    getCategoryEmoji,
    getStatusDisplay,
    renderTemplate,
    renderTemplateWithCategory,
    formatConsumptionList,
    formatDebtBreakdown,
    getTicketEmoji,

    // Templates
    RESPONSE_TEMPLATES
} from "./response-templates.js";
