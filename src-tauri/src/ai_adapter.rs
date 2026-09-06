use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
pub(crate) struct AiChatMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<AiToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct AiToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    function: AiToolCallFunction,
}

#[derive(Clone, Deserialize, Serialize)]
struct AiToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct AiTool {
    #[serde(rename = "type")]
    kind: String,
    function: AiToolFunction,
}

#[derive(Deserialize, Serialize)]
struct AiToolFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Deserialize)]
struct AiModel {
    id: String,
}

#[derive(Deserialize)]
struct AiModelsResponse {
    data: Vec<AiModel>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct AiChatResponseMessage {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<AiToolCall>,
}

#[derive(Deserialize)]
struct AiChatChoice {
    message: AiChatResponseMessage,
}

#[derive(Deserialize)]
struct AiChatResponse {
    choices: Vec<AiChatChoice>,
}

#[derive(Deserialize)]
struct AiApiErrorBody {
    error: Option<AiApiError>,
}

#[derive(Deserialize)]
struct AiApiError {
    message: Option<String>,
}

fn ai_api_url(endpoint: &str, resource: &str) -> Result<reqwest::Url, String> {
    let mut endpoint = reqwest::Url::parse(endpoint.trim()).map_err(|_| {
        "Enter a complete AI endpoint, such as http://localhost:11434/v1.".to_string()
    })?;
    if endpoint.scheme() != "http" && endpoint.scheme() != "https" {
        return Err("The AI endpoint must use http or https.".into());
    }
    if endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("The AI endpoint cannot contain a query or fragment.".into());
    }
    let path = endpoint.path().trim_end_matches('/');
    if !path.ends_with("/v1") {
        return Err("The AI endpoint must include its /v1 path.".into());
    }
    endpoint.set_path(&format!("{path}/"));
    endpoint
        .join(resource)
        .map_err(|error| format!("Could not build the AI request URL: {error}"))
}

fn ai_request(
    client: &reqwest::Client,
    url: reqwest::Url,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let request = client.request(reqwest::Method::GET, url);
    if api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(api_key.trim())
    }
}

async fn ai_response_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<AiApiErrorBody>(&body)
        .ok()
        .and_then(|body| body.error)
        .and_then(|error| error.message)
        .filter(|message| !message.trim().is_empty());
    match message {
        Some(message) => format!("AI server returned {status}: {message}"),
        None => format!("AI server returned {status}."),
    }
}

fn ai_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent(format!("Amanite/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not prepare the AI connection: {error}"))
}

#[tauri::command]
pub(crate) async fn ai_list_models(
    endpoint: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let client = ai_client()?;
    let response = ai_request(&client, ai_api_url(&endpoint, "models")?, &api_key)
        .send()
        .await
        .map_err(|error| format!("Could not reach the AI server: {error}"))?;
    if !response.status().is_success() {
        return Err(ai_response_error(response).await);
    }
    let mut models = response
        .json::<AiModelsResponse>()
        .await
        .map_err(|error| format!("The AI server returned an invalid models response: {error}"))?
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();
    models.sort_by_key(|model| model.to_lowercase());
    models.dedup();
    Ok(models)
}

#[tauri::command]
pub(crate) async fn ai_chat(
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<AiChatMessage>,
    tools: Vec<AiTool>,
) -> Result<AiChatResponseMessage, String> {
    if model.trim().is_empty() {
        return Err("Choose an AI model in settings.".into());
    }
    if messages.is_empty() {
        return Err("Write a message before sending.".into());
    }
    if messages.iter().any(|message| match message.role.as_str() {
        "system" | "user" => message
            .content
            .as_deref()
            .is_none_or(|content| content.trim().is_empty()),
        "assistant" => {
            message
                .content
                .as_deref()
                .is_none_or(|content| content.trim().is_empty())
                && message.tool_calls.is_empty()
        }
        "tool" => {
            message
                .content
                .as_deref()
                .is_none_or(|content| content.trim().is_empty())
                || message
                    .tool_call_id
                    .as_deref()
                    .is_none_or(|id| id.trim().is_empty())
        }
        _ => true,
    }) {
        return Err("The chat contains an invalid message.".into());
    }

    let client = ai_client()?;
    let url = ai_api_url(&endpoint, "chat/completions")?;
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::to_value(tools)
            .map_err(|error| format!("Could not prepare AI tools: {error}"))?;
        body["tool_choice"] = serde_json::Value::String("auto".into());
    }
    let request = client.post(url).json(&body);
    let request = if api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(api_key.trim())
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach the AI server: {error}"))?;
    if !response.status().is_success() {
        return Err(ai_response_error(response).await);
    }
    response
        .json::<AiChatResponse>()
        .await
        .map_err(|error| format!("The AI server returned an invalid chat response: {error}"))?
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .filter(|message| {
            message
                .content
                .as_deref()
                .is_some_and(|content| !content.trim().is_empty())
                || !message.tool_calls.is_empty()
        })
        .ok_or_else(|| "The AI server returned an empty reply.".into())
}

#[cfg(test)]
mod tests {
    use super::ai_api_url;

    #[test]
    fn ai_urls_require_and_preserve_the_v1_base() {
        assert_eq!(
            ai_api_url("http://localhost:11434/v1", "models")
                .unwrap()
                .as_str(),
            "http://localhost:11434/v1/models"
        );
        assert_eq!(
            ai_api_url("https://example.com/openai/v1/", "chat/completions")
                .unwrap()
                .as_str(),
            "https://example.com/openai/v1/chat/completions"
        );
        assert!(ai_api_url("https://example.com", "models").is_err());
        assert!(ai_api_url("file:///tmp/v1", "models").is_err());
    }
}
