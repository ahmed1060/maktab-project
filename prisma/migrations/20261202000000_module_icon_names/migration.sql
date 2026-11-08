-- A module's icon is one of the app's own, by its Phosphor name, where it
-- was any emoji (UI_PLAN.md §4.4, DESIGN.md §6). What companies chose is
-- mapped: each emoji that was a module's default until the side bar moved
-- onto the building blocks (PR 203) becomes the icon that took its place
-- there, with or without the emoji's variation mark, and any other emoji
-- goes, so the module shows its own icon. A module's own icon is no choice
-- of the company's, and isn't kept; nor is anything for a module there's no
-- longer. A name already there is left as it is, and the code drops one
-- that isn't on its list. The names companies gave their modules are
-- untouched.
--
-- Data only, and safe for the code before it: that code drops anything that
-- isn't an emoji, so the module shows its own icon.
UPDATE "Company" AS c
SET "moduleIcons" = (
    SELECT jsonb_object_agg(chosen.key, chosen.icon)
    FROM (
        SELECT kv.key,
               CASE
                   WHEN kv.value #>> '{}' ~ '^[a-z]+(-[a-z]+)*$' THEN kv.value #>> '{}'
                   ELSE (
                       SELECT old.icon
                       FROM (VALUES
                           ('📊', 'squares-four'),
                           ('✅', 'check-square'),
                           ('📌', 'push-pin'),
                           ('📩', 'tray'),
                           ('🗂', 'folders'),
                           ('💰', 'coins'),
                           ('👥', 'users'),
                           ('🚚', 'handshake'),
                           ('🗺', 'map-trifold')
                       ) AS old(emoji, icon)
                       -- Between the first quotes is U+FE0F, the mark asking for an
                       -- emoji's colour form: the palette's 🗂️ and 🗺️ had it, and
                       -- one pasted in may not. A literal, not chr(), so that a
                       -- database that isn't UTF-8 matches it too, byte for byte.
                       WHERE old.emoji = replace(kv.value #>> '{}', '️', '')
                   )
               END AS icon
        FROM jsonb_each(c."moduleIcons") AS kv
        WHERE jsonb_typeof(kv.value) = 'string'
    ) AS chosen
    JOIN (VALUES
        ('dashboard', 'squares-four'),
        ('tasks', 'check-square'),
        ('obligations', 'push-pin'),
        ('requests', 'tray'),
        ('records', 'folders'),
        ('costs', 'coins'),
        ('employees', 'users'),
        ('clients', 'handshake'),
        ('locations', 'map-trifold')
    ) AS module(key, own) ON module.key = chosen.key
    WHERE chosen.icon IS NOT NULL
      AND chosen.icon <> module.own
)
WHERE jsonb_typeof(c."moduleIcons") = 'object';
