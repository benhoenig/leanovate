
CREATE TABLE ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  user_id uuid REFERENCES profiles(id),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_log_function ON ai_usage_log(function_name);
CREATE INDEX idx_ai_usage_log_created_at ON ai_usage_log(created_at);

-- RLS: admins can read all, authenticated users can insert
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all usage logs"
  ON ai_usage_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Authenticated users can insert usage logs"
  ON ai_usage_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow edge functions (service role) to insert without RLS
CREATE POLICY "Service role full access"
  ON ai_usage_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

