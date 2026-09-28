CREATE TABLE `brand` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `discount` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`receipt_item_id` integer,
	`description` text,
	`amount_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_item_id`) REFERENCES `receipt_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `merchant_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `merchant_alias_normalized_alias_idx` ON `merchant_alias` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `merchant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_alias_normalized_alias_idx` ON `product_alias` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `product_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_group_id` integer NOT NULL,
	`brand_id` integer,
	`name` text NOT NULL,
	`package_amount` real,
	`package_unit` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_group_id`) REFERENCES `product_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brand`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `receipt_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`product_id` integer,
	`position` integer NOT NULL,
	`raw_name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text,
	`unit_price_cents` integer,
	`total_price_cents` integer NOT NULL,
	`line_type` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `receipt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` integer NOT NULL,
	`merchant_raw_name` text,
	`purchase_date` text NOT NULL,
	`purchase_time` text,
	`total_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`image_path` text NOT NULL,
	`raw_ocr_text` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receipt_duplicate_candidate_idx` ON `receipt` (`merchant_id`,`purchase_date`,`total_cents`);--> statement-breakpoint
CREATE TABLE `warranty` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_item_id` integer NOT NULL,
	`type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`receipt_item_id`) REFERENCES `receipt_item`(`id`) ON UPDATE no action ON DELETE no action
);
