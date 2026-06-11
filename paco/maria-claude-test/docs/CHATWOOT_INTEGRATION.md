# Chatwoot/Agora Integration Reference

> **Purpose**: Direct integration between Maria Claude and Agora (Chatwoot) without n8n intermediary.
> **Last Updated**: 2026-01-11

---

## Architecture Flow

```
┌─────────────┐    Webhook POST     ┌─────────────┐    Claude SDK    ┌─────────────┐
│   Chatwoot  │ ─────────────────▶  │    Maria    │ ───────────────▶ │   Claude    │
│   (Agora)   │                     │   Server    │                  │     API     │
│             │ ◀─────────────────  │             │ ◀─────────────── │             │
└─────────────┘    API POST Reply   └─────────────┘    Response      └─────────────┘
```

**Important**: Chatwoot webhooks are ONE-WAY. To reply, you must make a separate HTTP POST to the Chatwoot API.

---

## Webhook Event Types

| Event | Description | When to Use |
|-------|-------------|-------------|
| `message_created` | New message in conversation | **Primary event for bot** |
| `message_updated` | Message modified | Rarely needed |
| `conversation_created` | New conversation started | Initialize context |
| `conversation_updated` | Conversation attributes changed | Track status |
| `conversation_status_changed` | Status changed (open/resolved/pending) | Handle resolution |
| `webwidget_triggered` | User opened live chat | Optional analytics |
| `conversation_typing_on` | Agent starts typing | Not needed for bot |
| `conversation_typing_off` | Agent stops typing | Not needed for bot |

---

## Message Types (`message_type`)

| Value | Code | Description |
|-------|------|-------------|
| `incoming` | 0 | From customer/end user |
| `outgoing` | 1 | From agent/bot |
| `activity` | 2 | Internal events/logs |
| `template` | 3 | Pre-defined structured messages |

**Bot should only process**: `message_type === "incoming"` (or value `0`)

---

## Content Types (`content_type`)

| Value | Code | Description |
|-------|------|-------------|
| `text` | 0 | Standard text message |
| `input_text` | 1 | Interactive text input |
| `input_textarea` | 2 | Multi-line text input |
| `input_email` | 3 | Email input field |
| `input_select` | 4 | Selection dropdown |
| `cards` | 5 | Rich cards |
| `form` | 6 | Form submission |
| `article` | 7 | Article/help content |
| `incoming_email` | 8 | Email message |
| `input_csat` | 9 | Customer satisfaction survey |
| `integrations` | 10 | Integration message |
| `sticker` | 11 | Sticker message |
| `voice_call` | 12 | Voice call |

---

## Attachment File Types (`file_type`)

| Value | Code | Description | Bot Handling |
|-------|------|-------------|--------------|
| `image` | 0 | Images (PNG, JPG, GIF, WebP) | Vision API |
| `audio` | 1 | Audio files, voice notes | Transcription |
| `video` | 2 | Video files | Extract frames or ignore |
| `file` | 3 | Documents (PDF, Word, Excel) | Parse if needed |
| `location` | 4 | Location sharing | Extract coordinates |
| `fallback` | 5 | Unsupported type fallback | Acknowledge |
| `share` | 6 | Shared content | Extract URL |
| `story_mention` | 7 | Instagram story mention | Instagram only |
| `contact` | 8 | Contact card (vCard) | Parse contact |
| `ig_reel` | 9 | Instagram reel | Instagram only |
| `ig_post` | 10 | Instagram post | Instagram only |
| `ig_story` | 11 | Instagram story | Instagram only |
| `embed` | 12 | Embedded content | Extract URL |

### Supported Document MIME Types
```
text/csv, text/plain, text/rtf, application/json, application/pdf, application/zip
application/msword, application/vnd.ms-excel, application/vnd.ms-powerpoint
application/vnd.openxmlformats-officedocument.wordprocessingml.document
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
application/vnd.openxmlformats-officedocument.presentationml.presentation
application/vnd.oasis.opendocument.text
application/vnd.oasis.opendocument.spreadsheet
```

---

## Webhook Payload Structure

### Full `message_created` Payload

```json
{
  "event": "message_created",
  "id": 502,
  "content": "Hola, quiero reportar una fuga",
  "created_at": "2026-01-11T10:30:00.000Z",
  "message_type": "incoming",
  "content_type": "text",
  "content_attributes": {},
  "source_id": "whatsapp:5214421234567",
  "sender": {
    "id": 123,
    "name": "Juan Pérez",
    "avatar": "https://agora.example.com/avatar.jpg",
    "type": "contact",
    "email": "juan@example.com",
    "phone_number": "+5214421234567"
  },
  "inbox": {
    "id": 1,
    "name": "WhatsApp CEA"
  },
  "conversation": {
    "id": 45,
    "inbox_id": 1,
    "status": "open",
    "agent_last_seen_at": null,
    "contact_last_seen_at": "2026-01-11T10:29:00.000Z",
    "timestamp": "2026-01-11T10:30:00.000Z",
    "additional_attributes": {
      "browser": {},
      "referer": null,
      "initiated_at": {}
    },
    "channel": "Channel::Whatsapp"
  },
  "account": {
    "id": 2,
    "name": "CEA Querétaro"
  },
  "attachments": []
}
```

### Payload with Image Attachment

```json
{
  "event": "message_created",
  "id": 503,
  "content": "Aquí está la foto de la fuga",
  "message_type": "incoming",
  "content_type": "text",
  "sender": {
    "id": 123,
    "name": "Juan Pérez"
  },
  "conversation": {
    "id": 45
  },
  "account": {
    "id": 2
  },
  "attachments": [
    {
      "id": 22,
      "message_id": 503,
      "file_type": "image",
      "account_id": 2,
      "extension": "jpg",
      "data_url": "https://agora.example.com/rails/active_storage/blobs/redirect/eyJfcmFpbHMi.../fuga.jpg",
      "thumb_url": "https://agora.example.com/rails/active_storage/representations/redirect/eyJfcmFpbHMi.../fuga.jpg",
      "file_size": 245678
    }
  ]
}
```

### Payload with Voice Note (Audio)

```json
{
  "event": "message_created",
  "id": 504,
  "content": "",
  "message_type": "incoming",
  "content_type": "text",
  "attachments": [
    {
      "id": 23,
      "message_id": 504,
      "file_type": "audio",
      "account_id": 2,
      "extension": "ogg",
      "data_url": "https://agora.example.com/rails/active_storage/blobs/redirect/eyJfcmFpbHMi.../voice.ogg",
      "thumb_url": null,
      "file_size": 34567
    }
  ]
}
```

### Payload with Location

```json
{
  "event": "message_created",
  "id": 505,
  "content": "",
  "message_type": "incoming",
  "attachments": [
    {
      "id": 24,
      "message_id": 505,
      "file_type": "location",
      "account_id": 2,
      "coordinates_lat": 20.5888,
      "coordinates_long": -100.3899,
      "fallback_title": "Mi ubicación",
      "data_url": null
    }
  ]
}
```

---

## Sending Response Back to Chatwoot (CRITICAL)

Chatwoot webhooks are **one-way**. To send a reply, you must make a **separate HTTP POST request** to the Chatwoot API.

### Endpoint
```
POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages
```

### Headers
```
Content-Type: application/json
api_access_token: YOUR_CHATWOOT_API_TOKEN
```

### Send Text Message

```typescript
const sendToChatwoot = async (
  accountId: number,
  conversationId: number,
  message: string
): Promise<void> => {
  const response = await fetch(
    `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_access_token': process.env.CHATWOOT_API_TOKEN!
      },
      body: JSON.stringify({
        content: message,
        message_type: 'outgoing',
        private: false
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chatwoot API error: ${response.status} - ${error}`);
  }

  return response.json();
};
```

### cURL Example

```bash
curl -X POST "https://agora.example.com/api/v1/accounts/2/conversations/45/messages" \
  -H "Content-Type: application/json" \
  -H "api_access_token: YOUR_TOKEN" \
  -d '{
    "content": "Hola Juan, soy María de CEA Querétaro. ¿En qué puedo ayudarte?",
    "message_type": "outgoing",
    "private": false
  }'
```

### Send Message with Attachment (multipart/form-data)

```bash
curl -X POST "https://agora.example.com/api/v1/accounts/2/conversations/45/messages" \
  -H "api_access_token: YOUR_TOKEN" \
  -F "content=Aquí está tu recibo" \
  -F "message_type=outgoing" \
  -F "attachments[]=@/path/to/recibo.pdf"
```

### TypeScript with Attachment

```typescript
const sendWithAttachment = async (
  accountId: number,
  conversationId: number,
  message: string,
  filePath: string
): Promise<void> => {
  const formData = new FormData();
  formData.append('content', message);
  formData.append('message_type', 'outgoing');
  formData.append('attachments[]', fs.createReadStream(filePath));

  const response = await fetch(
    `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: {
        'api_access_token': process.env.CHATWOOT_API_TOKEN!
      },
      body: formData
    }
  );

  if (!response.ok) {
    throw new Error(`Chatwoot API error: ${response.status}`);
  }
};
```

### API Response Format

```json
{
  "id": 506,
  "content": "Hola Juan, soy María...",
  "inbox_id": 1,
  "conversation_id": 45,
  "message_type": 1,
  "content_type": "text",
  "content_attributes": {},
  "created_at": 1704969000,
  "private": false,
  "source_id": null,
  "sender": {
    "id": null,
    "type": "agent_bot"
  }
}
```

---

## Complete Webhook Handler Example

```typescript
import express from 'express';

interface ChatwootWebhook {
  event: string;
  id: number;
  content: string;
  message_type: string;
  sender: { id: number; name: string; type: string };
  conversation: { id: number };
  account: { id: number };
  attachments: Array<{
    file_type: string;
    data_url: string;
  }>;
}

app.post('/chatwoot-webhook', async (req, res) => {
  const payload: ChatwootWebhook = req.body;

  // 1. Return 200 immediately to avoid timeout
  res.status(200).json({ received: true });

  // 2. Filter: only process incoming messages
  if (payload.event !== 'message_created') return;
  if (payload.message_type !== 'incoming') return;
  if (payload.sender.type !== 'contact') return; // Ignore agent/bot messages

  try {
    // 3. Extract message content
    let messageText = payload.content || '';

    // 4. Handle attachments
    for (const attachment of payload.attachments || []) {
      if (attachment.file_type === 'audio') {
        // Transcribe audio
        const transcription = await transcribeAudio(attachment.data_url);
        messageText += ` [Audio transcrito: ${transcription}]`;
      } else if (attachment.file_type === 'image') {
        // Process with vision
        messageText += ` [Imagen adjunta: ${attachment.data_url}]`;
      } else if (attachment.file_type === 'location') {
        messageText += ` [Ubicación compartida]`;
      }
    }

    // 5. Process with Maria/Claude
    const response = await runWorkflow({
      input_as_text: messageText,
      conversationId: `chatwoot-${payload.conversation.id}`,
      metadata: {
        name: payload.sender.name,
        chatwootAccountId: payload.account.id,
        chatwootConversationId: payload.conversation.id
      }
    });

    // 6. Send response back to Chatwoot
    await sendToChatwoot(
      payload.account.id,
      payload.conversation.id,
      response.output_text
    );

  } catch (error) {
    console.error('[Chatwoot Webhook] Error:', error);
    // Optionally send error message to conversation
    await sendToChatwoot(
      payload.account.id,
      payload.conversation.id,
      'Lo siento, tuve un problema procesando tu mensaje. Por favor intenta de nuevo.'
    );
  }
});
```

---

## TypeScript Types

```typescript
// Webhook Payload Types
interface ChatwootWebhookPayload {
  event: 'message_created' | 'message_updated' | 'conversation_created' |
         'conversation_updated' | 'conversation_status_changed' |
         'webwidget_triggered' | 'conversation_typing_on' | 'conversation_typing_off';
  id: number;
  content: string | null;
  created_at: string;
  message_type: 'incoming' | 'outgoing' | 'activity' | 'template';
  content_type: 'text' | 'input_select' | 'cards' | 'form' | 'article' |
                'incoming_email' | 'sticker' | 'voice_call';
  content_attributes: Record<string, unknown>;
  source_id: string | null;
  sender: ChatwootSender;
  inbox: ChatwootInbox;
  conversation: ChatwootConversation;
  account: ChatwootAccount;
  attachments: ChatwootAttachment[];
}

interface ChatwootSender {
  id: number;
  name: string;
  avatar: string | null;
  type: 'contact' | 'user' | 'agent_bot';
  email?: string;
  phone_number?: string;
}

interface ChatwootInbox {
  id: number;
  name: string;
}

interface ChatwootConversation {
  id: number;
  inbox_id: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed';
  agent_last_seen_at: string | null;
  contact_last_seen_at: string | null;
  timestamp: string;
  additional_attributes: Record<string, unknown>;
  channel: string;
}

interface ChatwootAccount {
  id: number;
  name: string;
}

interface ChatwootAttachment {
  id: number;
  message_id: number;
  file_type: 'image' | 'audio' | 'video' | 'file' | 'location' |
             'fallback' | 'share' | 'story_mention' | 'contact' |
             'ig_reel' | 'ig_post' | 'ig_story' | 'embed';
  account_id: number;
  extension: string | null;
  data_url: string | null;
  thumb_url: string | null;
  file_size: number;
  // Location-specific fields
  coordinates_lat?: number;
  coordinates_long?: number;
  fallback_title?: string;
}

// API Request Types
interface SendMessageRequest {
  content: string;
  message_type?: 'outgoing' | 'incoming';
  private?: boolean;
  content_attributes?: Record<string, unknown>;
}
```

---

## Environment Variables

```env
# Chatwoot/Agora Configuration
CHATWOOT_BASE_URL=https://agora.example.com
CHATWOOT_API_TOKEN=your_api_access_token
CHATWOOT_ACCOUNT_ID=2

# Optional: Webhook secret for validation
CHATWOOT_WEBHOOK_SECRET=your_webhook_secret
```

---

## Implementation Checklist

### Webhook Handler

- [ ] Create `/chatwoot-webhook` endpoint
- [ ] Return 200 immediately (process async)
- [ ] Filter by `event === "message_created"`
- [ ] Filter by `message_type === "incoming"`
- [ ] Filter by `sender.type === "contact"` (ignore bot's own messages)
- [ ] Extract `conversation.id` for replies
- [ ] Extract `account.id` for API calls
- [ ] Extract `sender.name` and `sender.phone_number` for context
- [ ] Handle `content` for text messages
- [ ] Handle `attachments` array for media

### Attachment Processing

- [ ] **Images**: Download from `data_url`, send to Claude Vision
- [ ] **Audio/Voice**: Download from `data_url`, transcribe with Whisper API
- [ ] **Location**: Extract `coordinates_lat`/`coordinates_long` for service area
- [ ] **Files**: Download and parse if relevant (receipts, documents)
- [ ] **Fallback**: Acknowledge unsupported types gracefully

### Response Sending

- [ ] Use correct `account_id` and `conversation_id` from webhook
- [ ] Set `message_type: "outgoing"`
- [ ] Handle API errors (rate limits, auth failures)
- [ ] Implement retry logic for failed sends
- [ ] Support multipart for sending attachments (future)

---

## Security Considerations

1. **Validate webhook source** - Check request origin or use webhook secret
2. **Rate limiting** - Implement rate limiting on webhook endpoint
3. **Idempotency** - Handle duplicate webhook deliveries (check message ID)
4. **Error handling** - Return 200 quickly, process async to avoid timeouts
5. **Logging** - Log all webhook payloads for debugging (sanitize PII)

---

## Sources

- [Chatwoot Webhook Events](https://www.chatwoot.com/docs/product/others/webhook-events)
- [Chatwoot Webhooks Guide](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks)
- [API Channel - Receive Messages](https://www.chatwoot.com/docs/product/channels/api/receive-messages)
- [API Channel - Send Messages](https://www.chatwoot.com/docs/product/channels/api/send-messages)
- [GitHub Discussion - Attachments API](https://github.com/orgs/chatwoot/discussions/1809)
- [Chatwoot Message Model](https://github.com/chatwoot/chatwoot/blob/develop/app/models/message.rb)
- [Chatwoot Attachment Model](https://github.com/chatwoot/chatwoot/blob/develop/app/models/attachment.rb)
- [Chatwoot Developers API](https://developers.chatwoot.com/introduction)
