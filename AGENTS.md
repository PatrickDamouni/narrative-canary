# Project instructions

Narrative Canary is a defensive cybersecurity research project.

## Product rules

- Keep all scenarios synthetic and isolated from real organizations.
- Never generate functional credentials, malware, persistence, exploitation, or unauthorized scanning features.
- Optimize for measurable deception quality, not the number of generated artifacts.
- Preserve provenance for generated facts and artifacts so contradictions can be traced.
- Every experiment must include a comparable baseline.
- Treat "revolutionary" and similar claims as unproven until supported by reproducible results.

## Engineering defaults

- TypeScript with strict type checking.
- Pure domain logic should be testable without a UI or language-model API.
- Use provider interfaces for language models and telemetry backends.
- No secrets in source control; include `.env.example` when integrations begin.
- Prefer deterministic fixtures for tests.
- Keep the first release runnable locally.
