-- Migration: Add WhatsApp Broadcast Campaigns & Queue
-- Schema: Glowix_cosmetics

CREATE TABLE IF NOT EXISTS Glowix_cosmetics.broadcast_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    name text DEFAULT 'Promotional Broadcast'::text NOT NULL,
    title text DEFAULT 'Promotional Broadcast'::text NOT NULL,
    segment text DEFAULT 'all'::text NOT NULL,
    audience_filter text DEFAULT 'all'::text NOT NULL,
    message text,
    message_template text,
    media_url text,
    media_type text,
    total_recipients integer DEFAULT 0 NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    delay_seconds integer DEFAULT 10 NOT NULL,
    delay_seconds_min integer DEFAULT 8 NOT NULL,
    delay_seconds_max integer DEFAULT 15 NOT NULL,
    batch_size integer DEFAULT 30 NOT NULL,
    batch_cooldown_seconds integer DEFAULT 120 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broadcast_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sending'::text, 'in_progress'::text, 'completed'::text, 'paused'::text, 'cancelled'::text, 'failed'::text])))
);

CREATE TABLE IF NOT EXISTS Glowix_cosmetics.broadcast_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES Glowix_cosmetics.broadcast_campaigns(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    phone_number text NOT NULL,
    customer_name text,
    recipient_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broadcast_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_user_id ON Glowix_cosmetics.broadcast_campaigns USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue_campaign_id ON Glowix_cosmetics.broadcast_queue USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue_status ON Glowix_cosmetics.broadcast_queue USING btree (status);
CREATE INDEX IF NOT EXISTS idx_broadcast_queue_user_id ON Glowix_cosmetics.broadcast_queue USING btree (user_id);

-- RLS
ALTER TABLE Glowix_cosmetics.broadcast_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE Glowix_cosmetics.broadcast_queue ENABLE ROW LEVEL SECURITY;

-- Policies for broadcast_campaigns
CREATE POLICY "Users can manage own broadcast campaigns" ON Glowix_cosmetics.broadcast_campaigns
    FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

-- Policies for broadcast_queue
CREATE POLICY "Users can manage own broadcast queue" ON Glowix_cosmetics.broadcast_queue
    FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

-- Grants
GRANT ALL ON TABLE Glowix_cosmetics.broadcast_campaigns TO anon;
GRANT ALL ON TABLE Glowix_cosmetics.broadcast_campaigns TO authenticated;
GRANT ALL ON TABLE Glowix_cosmetics.broadcast_campaigns TO service_role;

GRANT ALL ON TABLE Glowix_cosmetics.broadcast_queue TO anon;
GRANT ALL ON TABLE Glowix_cosmetics.broadcast_queue TO authenticated;
GRANT ALL ON TABLE Glowix_cosmetics.broadcast_queue TO service_role;
