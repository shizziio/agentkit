-- Epic-level dependencies: stores JSON array of epic keys (e.g. ["24", "25"])
ALTER TABLE `epics` ADD `depends_on` text;
