CREATE TABLE `weatherSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`payload` text NOT NULL,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weatherSnapshots_id` PRIMARY KEY(`id`)
);
