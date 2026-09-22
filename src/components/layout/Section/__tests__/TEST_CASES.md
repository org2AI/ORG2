# SectionLayout acceptance cases

| Primitive        | Case            | Expected result                                         |
| ---------------- | --------------- | ------------------------------------------------------- |
| `SectionHeading` | Default section | Preserves the existing sticky section heading contract. |

## Verification

- Static render: `Heading.test.ts`.
- Static gates: TypeScript typecheck and ESLint.
