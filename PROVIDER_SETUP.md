# Configuring an Alternative Provider in LoomFlo

By default LoomFlo uses Anthropic's Claude API.
To switch to an OpenAI-compatible provider, set the provider in your project config
and export an API key before starting the daemon.

## Moonshot / Kimi (recommended alternative)

```bash
export MOONSHOT_API_KEY='sk-...'
```

`.loomflo/config.json`:

```json
{ "provider": "moonshot" }
```

## Nvidia NIM (open-source models)

```bash
export NVIDIA_API_KEY='nvapi-...'
```

`.loomflo/config.json`:

```json
{ "provider": "nvidia" }
```

## OpenAI

```bash
export OPENAI_API_KEY='sk-...'
```

`.loomflo/config.json`:

```json
{ "provider": "openai" }
```

## Override model and endpoint

```bash
export OPENAI_COMPAT_MODEL='moonshot-v1-32k'
export OPENAI_BASE_URL='https://custom-endpoint/v1'
```
