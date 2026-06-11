// ============================================
// Internal REST Routes
// For operational visibility and future integrations
// Protected by apiKeyAuth middleware
// ============================================

import { Router } from "express";
import * as ceaApi from "../services/cea-api.js";
import * as agoraDb from "../services/agora-db.js";
import { resolveContract } from "../services/hydra-db.js";
import { validateContrato, ValidationError } from "../services/validation.js";

const router = Router();

router.get("/internal/deuda/:contrato", async (req, res) => {
    try {
        const contrato = validateContrato(req.params.contrato);
        const resolved = await resolveContract(contrato);
        const result = await ceaApi.getDeudaContrato(resolved);
        res.json(result);
    } catch (error) {
        if (error instanceof ValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Internal error" });
    }
});

router.get("/internal/contrato/:contrato", async (req, res) => {
    try {
        const contrato = validateContrato(req.params.contrato);
        const resolved = await resolveContract(contrato);
        const { parsed } = await ceaApi.getContratoDetails(resolved);
        res.json(parsed);
    } catch (error) {
        if (error instanceof ValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Internal error" });
    }
});

router.get("/internal/tickets/:contract", async (req, res) => {
    try {
        const tickets = await agoraDb.getClientTickets(req.params.contract);
        res.json({ success: true, tickets });
    } catch (error) {
        if (error instanceof ValidationError) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Internal error" });
    }
});

export default router;
