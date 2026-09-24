-- Migration: Add product categorization (combo vs single) and pre-order tracking
-- Schema: Glowix_cosmetics

ALTER TABLE Glowix_cosmetics.products
ADD COLUMN IF NOT EXISTS category text DEFAULT 'single' NOT NULL;

ALTER TABLE Glowix_cosmetics.orders
ADD COLUMN IF NOT EXISTS is_preorder boolean DEFAULT false NOT NULL;
