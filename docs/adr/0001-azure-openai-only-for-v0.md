# Azure OpenAI only for V0

V0 will call Azure OpenAI only, with endpoint, API key, deployment name, and API version supplied through configuration. This deliberately avoids public OpenAI, local models, and a multi-provider abstraction so the **Personal Prototype** can prove the **Replacement Flow** quickly while still avoiding a hard-coded model deployment.
