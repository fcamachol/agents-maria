/**
 * HTTP SOAP Handler
 *
 * Executes SOAP API calls by rendering an XML envelope template,
 * posting it, and optionally extracting values via simple XPath-like patterns.
 */

import { fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import { renderTemplate } from "../template-engine.js";

export interface HttpSoapConfig {
  url: string;
  envelope_template: string; // XML SOAP envelope with {{args.*}} placeholders
  soap_action?: string;
  response_xpath?: string; // simple XPath-like extraction (e.g., "//deudaTotal")
}

/**
 * Simple XML tag value extractor (regex-based, same pattern as cea-tools parseXMLValue).
 * Supports "//tagName" notation to extract the text content of the first matching XML tag.
 */
function parseXMLValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract multiple XPath-like expressions from XML.
 * If a single "//tag" is given, returns just that value.
 * If multiple are comma-separated, returns an object with tag->value.
 */
function extractFromXml(xml: string, xpath: string): any {
  const expressions = xpath.split(",").map((s) => s.trim());

  if (expressions.length === 1) {
    const tag = expressions[0].replace(/^\/\//, "");
    return parseXMLValue(xml, tag);
  }

  const result: Record<string, string | null> = {};
  for (const expr of expressions) {
    const tag = expr.replace(/^\/\//, "");
    result[tag] = parseXMLValue(xml, tag);
  }
  return result;
}

export async function httpSoapHandler(
  config: HttpSoapConfig,
  args: Record<string, any>,
  env: Record<string, string>,
  toolName: string,
  dispatcher: Dispatcher | null,
  timeoutMs: number = 30000,
): Promise<string> {
  // Render the SOAP envelope
  const envelope = renderTemplate(config.envelope_template, args, env);
  const url = renderTemplate(config.url, args, env);

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "text/xml;charset=UTF-8",
  };
  if (config.soap_action) {
    headers["SOAPAction"] = renderTemplate(config.soap_action, args, env);
  }

  let response: Response;
  if (dispatcher) {
    response = (await undiciFetch(url, {
      method: "POST",
      headers,
      body: envelope,
      dispatcher,
      // @ts-ignore
      signal: AbortSignal.timeout(timeoutMs),
    })) as unknown as Response;
  } else {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  const xml = await response.text();

  if (!response.ok) {
    throw new Error(
      `SOAP HTTP ${response.status}: ${xml.substring(0, 500)}`,
    );
  }

  // Check for SOAP faults
  const fault = parseXMLValue(xml, "faultstring");
  if (fault) {
    throw new Error(`SOAP Fault: ${fault}`);
  }

  // Extract response if xpath pattern specified
  if (config.response_xpath) {
    const extracted = extractFromXml(xml, config.response_xpath);
    if (extracted !== null && extracted !== undefined) {
      return typeof extracted === "string" ? extracted : JSON.stringify(extracted);
    }
  }

  // Return full XML response
  return xml;
}
