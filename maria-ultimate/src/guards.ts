// guards.ts - Output guardrails for Maria WhatsApp agent

export interface GuardResult {
    passed: boolean;
    guardName: string;
    message?: string;
    severity: "block" | "warn";
}

export class GuardSystem {
    /**
     * Detect hallucinated folio numbers.
     * If output contains CEA-\d{4,8}-\d{3,6} or folio\s*[#:]?\s*\d{4,}
     * but create_ticket was NOT in toolsUsed -> block
     */
    checkFolioHallucination(output: string, toolsUsed: string[]): GuardResult {
        const hasFolioPattern =
            /\bCEA-\d{4,8}-\d{3,6}\b/i.test(output) ||
            /\bfolio\s*[#:]?\s*\d{4,}/i.test(output);
        const calledCreateTicket = toolsUsed.includes("create_ticket");

        if (hasFolioPattern && !calledCreateTicket) {
            return {
                passed: false,
                guardName: "folio_hallucination",
                message:
                    "Hubo un problema al registrar tu reporte. Dejame intentarlo de nuevo. Podrias repetir tu solicitud?",
                severity: "block",
            };
        }
        return { passed: true, guardName: "folio_hallucination", severity: "block" };
    }

    /**
     * Detect if sensitive contract data was shown without identity verification.
     * If output contains sensitive patterns AND a data tool was called
     * BUT validate_contract_holder was NOT called -> warn
     */
    checkIdentityBypass(output: string, toolsUsed: string[]): GuardResult {
        const sensitivePatterns = [
            /titular[:\s]/i,
            /saldo[:\s]/i,
            /\$[\d,]+/,
            /adeudo/i,
            /consumo.*m[³3]/i,
            /direccion[:\s]/i,
        ];

        const dataTools = [
            "get_deuda",
            "get_contract_details",
            "get_consumo",
            "get_client_tickets",
        ];

        const calledDataTool = dataTools.some((tool) => toolsUsed.includes(tool));
        const calledValidation = toolsUsed.includes("validate_contract_holder");
        const hasSensitiveData = sensitivePatterns.some((pattern) => pattern.test(output));

        if (calledDataTool && !calledValidation && hasSensitiveData) {
            return {
                passed: false,
                guardName: "identity_bypass",
                message:
                    "Para proteger tus datos, necesito verificar tu identidad antes de continuar. Me puedes dar el nombre o apellido del titular del contrato?",
                severity: "warn",
            };
        }
        return { passed: true, guardName: "identity_bypass", severity: "warn" };
    }

    /**
     * Detect if agent claims ticket was created but create_ticket wasn't called.
     */
    checkTicketHallucination(output: string, toolsUsed: string[]): GuardResult {
        const ticketClaimPatterns = [
            /registr[eé] tu reporte/i,
            /tu ticket/i,
            /tu reporte ha sido/i,
            /reporte registrado/i,
            /cre[eé] tu reporte/i,
            /levant[eé] tu reporte/i,
        ];

        const claimsTicket = ticketClaimPatterns.some((pattern) => pattern.test(output));
        const calledCreateTicket = toolsUsed.includes("create_ticket");

        if (claimsTicket && !calledCreateTicket) {
            return {
                passed: false,
                guardName: "ticket_hallucination",
                message:
                    "Hubo un problema al registrar tu reporte. Dejame intentarlo de nuevo. Podrias repetir tu solicitud?",
                severity: "block",
            };
        }
        return { passed: true, guardName: "ticket_hallucination", severity: "block" };
    }

    /**
     * Run all guards. Return first failure or all-pass result.
     * Block-severity failures take priority over warn-severity.
     */
    runAll(output: string, toolsUsed: string[]): GuardResult {
        const results = [
            this.checkFolioHallucination(output, toolsUsed),
            this.checkTicketHallucination(output, toolsUsed),
            this.checkIdentityBypass(output, toolsUsed),
        ];

        // Return first block failure, then first warn failure
        const blockFailure = results.find((r) => !r.passed && r.severity === "block");
        if (blockFailure) return blockFailure;

        const warnFailure = results.find((r) => !r.passed && r.severity === "warn");
        if (warnFailure) return warnFailure;

        return { passed: true, guardName: "all", severity: "block" };
    }
}
