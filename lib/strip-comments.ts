/**
 * Source with its comments removed, for tests that assert on code.
 *
 * Several guards in this repo check that some identifier, path or notation does
 * *not* appear in a file. Every one of them has the same failure: the comment
 * explaining why the thing was removed names the thing, so a plain substring
 * check matches the explanation and passes while the code is still wrong — or,
 * just as often, fails on prose when the code is right.
 *
 * That has now happened four times here: a dead cron aggregate, a dropped
 * column, a hand-measured offset, and a deleted media query — the last one in
 * the very comment written to explain the deletion. Four is enough to stop
 * writing the strip inline each time.
 *
 * Handles `//` line comments and `/* *\/` blocks, which between them cover
 * TypeScript, TSX and CSS. Deliberately naive about the one case it cannot
 * distinguish — a comment opener inside a string literal — because the
 * alternative is a parser, and the cost of getting that wrong in a guard is a
 * test that reads slightly less source than it meant to, not a wrong answer
 * about the code that is there.
 */
export function stripComments(source: string): string {
    return source
        // Block comments first: a `//` inside one would otherwise survive.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map(line => line.replace(/(^|\s)\/\/.*$/, "$1"))
        .join("\n")
}
