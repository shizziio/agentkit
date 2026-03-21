-- Story waiting_stage: tracks which stage a story should resume at when deps are met
ALTER TABLE `stories` ADD `waiting_stage` text;
