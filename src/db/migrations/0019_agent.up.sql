-- ZAMO-AGENT-046..054 :: agent — smart agent tables.
--
-- M10 Agent module (ARCHITECTURE.md §9).
--
-- Implements:
--   ARCH §9.2 rule 3: Every tool call logged (tool_calls table).
--   ARCH §9.2 rule 5: Tool enable/disable takes effect immediately (agent_tools).
--   A-34: Conversation starts before login (patient_id nullable until booking).
--   A-38: No "best doctor" without data (enforced by output guard, not DB).
--   B-09: LLM provider abstracted (config stored in agent_config).
--   B-22: Nomination reasons from data only (search module integration).
--   OQ-020: Emergency rules (input guard, logged in messages).
--
-- Depends on: 0017_bookings (bookings)
--             0001_core_identity (users)

-- ---------------------------------------------------------------------------
-- conversations — chat sessions between user and agent.
--
-- A-34: patient_id is nullable because conversations can start
--        before the user registers/logs in.
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHO (nullable until OTP verification — A-34)
  patient_id        uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Language (detected from first message, switchable)
  language          text NOT NULL DEFAULT 'ar'
                    CHECK (language IN ('ar', 'en')),

  -- Conversation state
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN (
                      'active',           -- ongoing conversation
                      'completed',        -- user goal achieved
                      'escalated',        -- handed to human agent
                      'abandoned'         -- timeout / user left
                    )),

  -- Escalation tracking (AGENT-053)
  escalated_at      timestamptz,
  escalation_reason text,
  escalated_to      uuid REFERENCES users(id),  -- the human agent

  -- Context: campaign/session attribution (for future analytics)
  source            text,  -- e.g. 'web', 'whatsapp', 'widget'

  -- Booking created from this conversation (if any)
  booking_id        uuid REFERENCES bookings(id),

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conv_patient_idx ON conversations (patient_id);
CREATE INDEX conv_status_idx ON conversations (status);
CREATE INDEX conv_created_idx ON conversations (created_at DESC);
CREATE INDEX conv_escalated_idx ON conversations (status, escalated_at)
  WHERE status = 'escalated';

CREATE TRIGGER conversations_touch BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- conversation_messages — individual messages in a conversation.
--
-- Roles:
--   'user'        — patient message
--   'assistant'   — agent response
--   'system'      — system prompt / guardrail message
--   'tool_call'   — agent requesting a tool
--   'tool_result' — result from tool execution
-- ---------------------------------------------------------------------------
CREATE TABLE conversation_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Message ordering (monotonically increasing per conversation)
  sequence          integer NOT NULL,

  -- Role
  role              text NOT NULL CHECK (role IN (
    'user', 'assistant', 'system', 'tool_call', 'tool_result'
  )),

  -- Content
  content           text NOT NULL DEFAULT '',

  -- For tool_call / tool_result: link to tool_calls record
  tool_call_id      uuid,  -- FK added after tool_calls table

  -- Guard results (if input/output guard intervened)
  guard_action      text CHECK (guard_action IS NULL OR guard_action IN (
    'passed',             -- guard allowed the message
    'blocked_medical',    -- input guard: medical intent detected
    'blocked_emergency',  -- input guard: emergency detected
    'blocked_injection',  -- input guard: prompt injection detected
    'blocked_output',     -- output guard: unsafe output blocked
    'sanitized'           -- output guard: content was cleaned
  )),

  -- Metadata (JSON: tokens used, model, latency, etc.)
  metadata          jsonb DEFAULT '{}',

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX msg_conv_seq_idx ON conversation_messages (conversation_id, sequence);

-- Unique constraint: one sequence number per conversation
ALTER TABLE conversation_messages
  ADD CONSTRAINT msg_conv_seq_unique UNIQUE (conversation_id, sequence);

-- ---------------------------------------------------------------------------
-- tool_calls — log of every tool invocation (ARCH §9.2 rule 3).
--
-- «كل استدعاء أداة يُسجَّل بمدخلاته ومخرجاته»
-- ---------------------------------------------------------------------------
CREATE TABLE tool_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id        uuid,  -- FK to conversation_messages (set after insert)

  -- Which tool
  tool_name         text NOT NULL,

  -- Input/Output (JSON)
  input_params      jsonb NOT NULL DEFAULT '{}',
  output_result     jsonb,
  output_error      text,

  -- Execution
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  duration_ms       integer,

  -- Was the tool enabled at call time?
  tool_was_enabled  boolean NOT NULL DEFAULT true,

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tc_conv_idx ON tool_calls (conversation_id);
CREATE INDEX tc_tool_name_idx ON tool_calls (tool_name);
CREATE INDEX tc_created_idx ON tool_calls (created_at DESC);

-- Add FK from conversation_messages to tool_calls
ALTER TABLE conversation_messages
  ADD CONSTRAINT msg_tool_call_fk
  FOREIGN KEY (tool_call_id) REFERENCES tool_calls(id);

-- ---------------------------------------------------------------------------
-- agent_config — agent instructions and templates.
--
-- Editable from Zamo admin dashboard. Changes take effect immediately
-- (loaded per-conversation, not cached permanently).
-- ---------------------------------------------------------------------------
CREATE TABLE agent_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Config key (unique identifier)
  config_key        text NOT NULL UNIQUE,

  -- Value (text for prompts/templates, or JSON for structured config)
  value_text        text,
  value_json        jsonb,

  -- Bilingual labels
  label_ar          text NOT NULL,
  label_en          text NOT NULL,
  description_ar    text,
  description_en    text,

  -- WHO last changed
  updated_by        uuid REFERENCES users(id),

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER agent_config_touch BEFORE UPDATE ON agent_config
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- Seed default config
INSERT INTO agent_config (config_key, label_ar, label_en, description_ar, description_en, value_text) VALUES
  ('system_prompt_ar', 'تعليمات الوكيل (عربي)', 'Agent Instructions (Arabic)',
   'التعليمات الأساسية للوكيل باللغة العربية', 'Core agent instructions in Arabic',
   'أنت مساعد ذكي في منصة زامو الطبية. دورك إداري فقط: مساعدة المرضى في البحث عن الخدمات الطبية وحجز المواعيد. أنت لست طبيباً ولا تقدم استشارات طبية أو تشخيصات أو توصيات علاجية. عند أي سؤال طبي، وجّه المريض لاستشارة طبيب مختص.'),
  ('system_prompt_en', 'تعليمات الوكيل (إنجليزي)', 'Agent Instructions (English)',
   'التعليمات الأساسية للوكيل باللغة الإنجليزية', 'Core agent instructions in English',
   'You are a smart assistant on the Zamo Medical platform. Your role is strictly administrative: helping patients search for medical services and book appointments. You are NOT a doctor and do NOT provide medical consultations, diagnoses, or treatment recommendations. For any medical question, direct the patient to consult a qualified physician.'),
  ('welcome_message_ar', 'رسالة الترحيب (عربي)', 'Welcome Message (Arabic)',
   'الرسالة التي تظهر عند بدء المحادثة', 'Message shown when conversation starts',
   'مرحباً! أنا المساعد الذكي في منصة زامو. يمكنني مساعدتك في البحث عن خدمات طبية وحجز المواعيد. ⚠️ أنا مساعد إداري ولا أقدم استشارات طبية. يمكنك التحويل لموظف بشري في أي وقت.'),
  ('welcome_message_en', 'رسالة الترحيب (إنجليزي)', 'Welcome Message (English)',
   'الرسالة التي تظهر عند بدء المحادثة بالإنجليزية', 'Message shown when conversation starts in English',
   'Hello! I am Zamo''s smart assistant. I can help you search for medical services and book appointments. ⚠️ I am an administrative assistant and do not provide medical consultations. You can transfer to a human agent at any time.'),
  ('emergency_message_ar', 'رسالة الطوارئ (عربي)', 'Emergency Message (Arabic)',
   'الرسالة التي تظهر عند كشف حالة طارئة', 'Message shown when emergency is detected',
   '🚨 يبدو أنك تصف حالة طارئة. أرجوك اتصل فوراً بالطوارئ على الرقم 997. منصة زامو هي خدمة حجز مواعيد ولا تقدم رعاية طبية طارئة. ⚠️ إخلاء مسؤولية: هذا المساعد الذكي ليس بديلاً عن الرعاية الطبية الطارئة.'),
  ('emergency_message_en', 'رسالة الطوارئ (إنجليزي)', 'Emergency Message (English)',
   'الرسالة التي تظهر عند كشف حالة طارئة بالإنجليزية', 'Message shown when emergency is detected in English',
   '🚨 It sounds like you may be describing an emergency. Please call 997 immediately. Zamo is an appointment booking service and does not provide emergency medical care. ⚠️ Disclaimer: This smart assistant is not a substitute for emergency medical care.');

-- ---------------------------------------------------------------------------
-- agent_tools — the 7 tools with enable/disable (ARCH §9.1, §9.2 rule 5).
--
-- «إيقاف أداة من لوحة الإدارة يجب أن يسري فورًا دون إعادة نشر»
-- ---------------------------------------------------------------------------
CREATE TABLE agent_tools (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tool identifier (matches code tool name)
  tool_name         text NOT NULL UNIQUE,

  -- Enable/disable (rule 5: takes effect immediately)
  enabled           boolean NOT NULL DEFAULT true,

  -- Bilingual labels
  label_ar          text NOT NULL,
  label_en          text NOT NULL,
  description_ar    text,
  description_en    text,

  -- WHO last changed
  updated_by        uuid REFERENCES users(id),

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER agent_tools_touch BEFORE UPDATE ON agent_tools
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- Seed the 7 tools (ARCHITECTURE §9.1) + escalate_to_human
INSERT INTO agent_tools (tool_name, label_ar, label_en, description_ar, description_en) VALUES
  ('search_services', 'بحث الخدمات', 'Search Services',
   'البحث عن الخدمات الطبية المتاحة', 'Search for available medical services'),
  ('search_doctors', 'بحث الأطباء', 'Search Doctors',
   'البحث عن الأطباء مع سبب الترشيح', 'Search for doctors with recommendation reasons'),
  ('get_availability', 'المواعيد المتاحة', 'Get Availability',
   'عرض المواعيد المتاحة للطبيب', 'Show available appointment slots for a doctor'),
  ('create_booking_req', 'إنشاء حجز', 'Create Booking',
   'إنشاء طلب حجز جديد (عبر State Machine)', 'Create a new booking request (via State Machine)'),
  ('reschedule', 'إعادة الجدولة', 'Reschedule',
   'إعادة جدولة حجز قائم', 'Reschedule an existing booking'),
  ('cancel', 'إلغاء الحجز', 'Cancel Booking',
   'إلغاء حجز قائم وتحرير الفتحة', 'Cancel an existing booking and release the slot'),
  ('get_booking_status', 'متابعة الحجز', 'Get Booking Status',
   'الاستعلام عن حالة حجز', 'Check the status of a booking'),
  ('escalate_to_human', 'تحويل لموظف', 'Escalate to Human',
   'تحويل المحادثة لموظف بشري', 'Transfer conversation to a human agent');

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tools ENABLE ROW LEVEL SECURITY;

-- Conversations: patient sees own, zamo_admin sees all
CREATE POLICY conv_patient_read ON conversations
  FOR SELECT
  USING (
    patient_id::text = current_setting('zamo.user_id', true)
    OR current_setting('zamo.role_code', true) = 'zamo_admin'
  );

CREATE POLICY conv_insert ON conversations
  FOR INSERT
  WITH CHECK (true);  -- anyone can start a conversation (A-34)

CREATE POLICY conv_update ON conversations
  FOR UPDATE
  USING (
    patient_id::text = current_setting('zamo.user_id', true)
    OR current_setting('zamo.role_code', true) = 'zamo_admin'
  );

-- Messages: follow conversation access
CREATE POLICY msg_read ON conversation_messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE patient_id::text = current_setting('zamo.user_id', true)
         OR current_setting('zamo.role_code', true) = 'zamo_admin'
    )
  );

CREATE POLICY msg_insert ON conversation_messages
  FOR INSERT
  WITH CHECK (true);  -- system inserts messages

-- Tool calls: zamo_admin sees all, patient sees own conversation's
CREATE POLICY tc_read ON tool_calls
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE patient_id::text = current_setting('zamo.user_id', true)
         OR current_setting('zamo.role_code', true) = 'zamo_admin'
    )
  );

CREATE POLICY tc_insert ON tool_calls
  FOR INSERT
  WITH CHECK (true);  -- system inserts tool calls

-- Agent config: zamo_admin only
CREATE POLICY agent_config_read ON agent_config
  FOR SELECT
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY agent_config_update ON agent_config
  FOR UPDATE
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

-- Agent tools: zamo_admin can read/update, agent system can read
CREATE POLICY agent_tools_read ON agent_tools
  FOR SELECT
  USING (true);  -- tools status needs to be readable by the agent system

CREATE POLICY agent_tools_update ON agent_tools
  FOR UPDATE
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');
