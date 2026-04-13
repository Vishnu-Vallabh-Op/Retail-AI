-- Chat History Schema for Supabase
-- Run this in your Supabase SQL Editor

-- Create chat_history table
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL, -- Groups messages in a conversation
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (you can restrict this later)
CREATE POLICY "Allow all operations on chat_history" ON chat_history
  FOR ALL USING (true);

-- Function to clean up old chat history (optional)
-- Keeps only last 1000 messages per session, deletes older ones
CREATE OR REPLACE FUNCTION cleanup_old_chat_history()
RETURNS void AS $$
BEGIN
  DELETE FROM chat_history
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
      FROM chat_history
    ) ranked
    WHERE rn > 1000
  );
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a trigger to auto-cleanup (runs daily)
-- You can set this up in Supabase Edge Functions or cron jobs

-- Example data (optional - for testing)
-- INSERT INTO chat_history (session_id, role, message) VALUES
-- ('session_001', 'user', 'What are the current retail trends?'),
-- ('session_001', 'assistant', 'Based on recent data, Electronics category shows strong growth...');