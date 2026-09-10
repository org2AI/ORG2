# SectionLayout acceptance cases

| Primitive        | Case            | Expected result                                                                                                |
| ---------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `SectionHeading` | Default section | Preserves the existing sticky section heading contract.                                                        |
| `SectionHeading` | Intro surface   | Owns the semantic heading level, description, optional icon, body spacing, and `aria-labelledby` relationship. |

## Verification

- Static render: `Heading.test.ts`.
- Static gates: TypeScript typecheck and ESLint.
