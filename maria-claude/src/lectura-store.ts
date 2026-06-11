// ============================================
// Lectura Attachment Store
// Shared state for linking Chatwoot attachments to lectura tickets
// Separated to avoid circular dependency between agent.ts and tools.ts
// ============================================

const lecturaAttachmentMap = new Map<string, number>();

export function setLecturaAttachmentId(conversationId: string, attachmentId: number): void {
    lecturaAttachmentMap.set(conversationId, attachmentId);
    console.log(`[LecturaStore] Stored attachmentId=${attachmentId} for conv ${conversationId}`);
}

export function getLecturaAttachmentId(conversationId: string): number | undefined {
    return lecturaAttachmentMap.get(conversationId);
}

export function clearLecturaAttachmentId(conversationId: string): void {
    lecturaAttachmentMap.delete(conversationId);
}
