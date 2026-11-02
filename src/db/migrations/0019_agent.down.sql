-- Rollback for 0019_agent.up.sql

-- Drop RLS policies
DROP POLICY IF EXISTS agent_tools_update ON agent_tools;
DROP POLICY IF EXISTS agent_tools_read ON agent_tools;
DROP POLICY IF EXISTS agent_config_update ON agent_config;
DROP POLICY IF EXISTS agent_config_read ON agent_config;
DROP POLICY IF EXISTS tc_insert ON tool_calls;
DROP POLICY IF EXISTS tc_read ON tool_calls;
DROP POLICY IF EXISTS msg_insert ON conversation_messages;
DROP POLICY IF EXISTS msg_read ON conversation_messages;
DROP POLICY IF EXISTS conv_update ON conversations;
DROP POLICY IF EXISTS conv_insert ON conversations;
DROP POLICY IF EXISTS conv_patient_read ON conversations;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS agent_tools CASCADE;
DROP TABLE IF EXISTS agent_config CASCADE;
DROP TABLE IF EXISTS tool_calls CASCADE;
DROP TABLE IF EXISTS conversation_messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
