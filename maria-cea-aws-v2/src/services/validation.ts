// ============================================
// Centralized Input Validators
// Shared by service layer and tools
// ============================================

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Validates a CEA contract number (4-10 digits).
 * Throws ValidationError if invalid.
 */
export function validateContrato(input: string): string {
    const trimmed = input.trim();
    if (!/^\d{4,10}$/.test(trimmed)) {
        throw new ValidationError(`Invalid contract format: ${trimmed.substring(0, 20)}`);
    }
    return trimmed;
}

/**
 * Validates a meter serial number (alphanumeric + hyphens, 3-30 chars).
 */
export function validateContador(input: string): string {
    const trimmed = input.trim();
    if (!/^[A-Za-z0-9\-]{3,30}$/.test(trimmed)) {
        throw new ValidationError(`Invalid meter number format`);
    }
    return trimmed;
}

/**
 * Validates a ticket folio (CEA-XXXXX or PREFIX-DATE-SEQ format).
 */
export function validateFolio(input: string): string {
    const trimmed = input.trim();
    // CEA-XXXX format (from DB trigger)
    if (/^CEA-\d+$/.test(trimmed)) return trimmed;
    // TKT-XXXX format (from API)
    if (/^TKT-\d+$/.test(trimmed)) return trimmed;
    // Legacy: PREFIX-DATE-SEQ (e.g., REP-FVP-20260311-0001)
    if (/^[A-Z]{2,4}(-[A-Z]{2,4})?-\d{6,10}-\d{3,5}$/.test(trimmed)) return trimmed;
    throw new ValidationError(`Invalid folio format`);
}

/**
 * Escapes special characters for safe XML embedding.
 * Prevents XML injection in SOAP requests.
 */
export function escapeXml(s: string): string {
    return s.replace(/[<>&'"]/g, c =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!)
    );
}
