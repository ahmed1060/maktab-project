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
            // Worth working through deliberately, in their own change. The
            // current count, for whoever picks that up:
            //   61  set-state-in-effect  — cascading renders
            //   32  error-boundaries     — JSX built inside try/catch
            //    6  purity               — impure calls during render
            //    1  immutability         — a variable reassigned after render
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/error-boundaries": "warn",
            "react-hooks/purity": "warn",
            "react-hooks/immutability": "warn",
        },
    },
]

export default config
