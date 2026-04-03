// ============================================
// Date Utilities - Mexico City timezone
// ============================================

export function getMexicoDate(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
}

export function getMexicoDateStr(): string {
    const now = getMexicoDate();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

export function buildSystemContext(): string {
    const now = getMexicoDate();
    const dateStr = now.toLocaleDateString("es-MX", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    return `[Fecha: ${dateStr}, Hora: ${timeStr} (hora de Querétaro)]`;
}
