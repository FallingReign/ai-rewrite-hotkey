# Direct REST to Azure Chat Completions first

V0 will use a small direct REST client targeting Azure OpenAI Chat Completions first, with endpoint, deployment name, and API version supplied by configuration. This avoids SDK and provider-abstraction complexity while making Azure-specific URLs, payloads, and errors easy to inspect during the **Personal Prototype**.
