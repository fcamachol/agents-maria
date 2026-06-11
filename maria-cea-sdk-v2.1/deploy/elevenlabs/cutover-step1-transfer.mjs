import { el } from "./_el.mjs";
const LIVE = "agent_7301kg0z72effkvtqghs2hx58bpt";
const WF   = "agent_0201ktm6ft1jehqrdt1qpg8dbmz8";

const live = await el(`/convai/agents/${LIVE}`);
const liveTransfer = (live.conversation_config.agent.prompt.built_in_tools || {}).transfer_to_number;
if (!liveTransfer) throw new Error("live agent has no transfer_to_number to copy");
console.log("live transfer dest:", JSON.stringify(liveTransfer.params?.transfers?.[0]?.transfer_destination));

const wf = await el(`/convai/agents/${WF}`);
const p = wf.conversation_config.agent.prompt;
const newPrompt = {
  ...p,
  tools: [],
  built_in_tools: { ...(p.built_in_tools || {}), transfer_to_number: liveTransfer },
};
await el(`/convai/agents/${WF}`, "PATCH", {
  name: "Maria CEA (Workflow)",
  conversation_config: { agent: { prompt: newPrompt } },
});

const after = await el(`/convai/agents/${WF}`);
const ap = after.conversation_config.agent.prompt;
console.log("name:", after.name);
console.log("transfer_to_number now on WF agent:", !!(ap.built_in_tools||{}).transfer_to_number ? "YES ✅" : "NO ❌");
console.log("preserved -> llm:", ap.llm, "| voice:", after.conversation_config.tts?.voice_id, "| tool_ids:", (ap.tool_ids||[]).length, "| workflow nodes:", Object.keys(after.workflow?.nodes||{}).length);
