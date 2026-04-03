// ============================================
// SOAP Request Builders - Credentials from config
// ============================================

import { cfg } from "../config/index.js";

function wsSecurityHeader(): string {
    return `<wsse:Security mustUnderstand="1">
            <wsse:UsernameToken wsu:Id="UsernameToken-CEA">
                <wsse:Username>${cfg.CEA_SOAP_USERNAME}</wsse:Username>
                <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${cfg.CEA_SOAP_PASSWORD}</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>`;
}

const SOAP_NS = `xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"`;

export function buildDeudaSOAP(contrato: string): string {
    return `<soapenv:Envelope ${SOAP_NS} xmlns:int="http://interfazgenericagestiondeuda.occamcxf.occam.agbar.com/">
    <soapenv:Header>
        ${wsSecurityHeader()}
    </soapenv:Header>
    <soapenv:Body>
        <int:getDeuda>
            <tipoIdentificador>CONTRATO</tipoIdentificador>
            <valor>${contrato}</valor>
            <explotacion>12</explotacion>
            <idioma>es</idioma>
        </int:getDeuda>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildConsumoSOAP(contrato: string): string {
    return `<soapenv:Envelope ${SOAP_NS} xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com">
    <soapenv:Header>
        ${wsSecurityHeader()}
    </soapenv:Header>
    <soapenv:Body>
        <occ:getConsumos>
            <explotacion>12</explotacion>
            <contrato>${contrato}</contrato>
            <idioma>es</idioma>
        </occ:getConsumos>
    </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildContratoSOAP(contrato: string): string {
    return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com">
    <soapenv:Header/>
    <soapenv:Body>
        <occ:consultaDetalleContrato>
            <numeroContrato>${contrato}</numeroContrato>
            <idioma>es</idioma>
        </occ:consultaDetalleContrato>
    </soapenv:Body>
</soapenv:Envelope>`;
}
