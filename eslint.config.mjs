import coreWebVitals from "eslint-config-next/core-web-vitals"
import typescript from "eslint-config-next/typescript"

/**
 * Flat config, because ESLint 9 dropped .eslintrc and eslint-config-next 16
 * ships nothing else. `ignores` replaces the .eslintignore that flat config
 * also dropped; without it ESLint walks the build output and reports thousands
 * of findings in generated code.
 */
const config = [
    {
        ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"],
    },

    ...coreWebVitals,
    ...typescript,

    {
        rules: {
            // Carried over from .eslintrc.json unchanged.
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": "warn",
            "react-hooks/exhaustive-deps": "warn",

            // The four below arrived with eslint-plugin-react-hooks 6, which
            // eslint-config-next 16 pulls in — they are the React Compiler's
            // static analyses, and nothing was checking for them before. They
            // report 100 findings across the existing UI, every one of them a
            // pattern that predates this upgrade by months.
            //
            // Downgraded to warnings rather than switched off, so they stay
            // visible and anything new still gets flagged in review. Left as
            // errors they would fail CI on a hundred things that a dependency
            // upgrade has no business rewriting: each fix changes when a
            // component renders, and doing sixty-one of those at once, untested
            // against a browser, is how an upgrade turns into an outage.
            //
            // Worked through deliberately since. Three of the four are at zero
            // and are errors now, so a new instance fails CI rather than
            // joining a pile of warnings nobody reads:
            //   error-boundaries — try/catch around JSX became SectionBoundary
            //   purity           — the clock read in render became useNow(),
            //                      and eleven copies of the deadline rule one
            //   immutability     — the donut's running total became precomputed
            //
            // set-state-in-effect stays a warning until it is at zero too:
            //   42  set-state-in-effect  — cascading renders
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/error-boundaries": "error",
            "react-hooks/purity": "error",
            "react-hooks/immutability": "error",
        },
    },
]

export default config
