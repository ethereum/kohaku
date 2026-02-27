#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    #[error("request error: {0}")]
    Request(String),
    #[error("http error: {0}")]
    Http(#[from] http::Error),
}

#[derive(Clone)]
pub struct HttpClient {
    #[cfg(not(target_arch = "wasm32"))]
    inner: reqwest::Client,
    #[cfg(target_arch = "wasm32")]
    user_agent: Option<String>,
}

impl HttpClient {
    pub fn new(user_agent: Option<&str>) -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            inner: {
                let mut b = reqwest::Client::builder();
                if let Some(ua) = user_agent {
                    b = b.user_agent(ua);
                }
                b.build().expect("failed to build http client")
            },
            #[cfg(target_arch = "wasm32")]
            user_agent: user_agent.map(|s| s.to_string()),
        }
    }

    pub async fn get(&self, url: &str) -> Result<http::Response<Vec<u8>>, HttpError> {
        let req = http::Request::builder()
            .method(http::Method::GET)
            .uri(url)
            .body(vec![])?;
        self.send(req).await
    }

    pub async fn post_json<T: serde::Serialize>(
        &self,
        url: &str,
        body: &T,
    ) -> Result<http::Response<Vec<u8>>, HttpError> {
        let body = serde_json::to_vec(body).map_err(|e| HttpError::Request(e.to_string()))?;
        let req = http::Request::builder()
            .method(http::Method::POST)
            .uri(url)
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(body)?;
        self.send(req).await
    }

    pub async fn send(
        &self,
        req: http::Request<Vec<u8>>,
    ) -> Result<http::Response<Vec<u8>>, HttpError> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.send_reqwest(req).await
        }

        #[cfg(target_arch = "wasm32")]
        {
            self.send_gloo(req).await
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl HttpClient {
    async fn send_reqwest(
        &self,
        req: http::Request<Vec<u8>>,
    ) -> Result<http::Response<Vec<u8>>, HttpError> {
        let (parts, body) = req.into_parts();

        let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes())
            .map_err(|e| HttpError::Request(e.to_string()))?;

        let mut builder = self.inner.request(method, parts.uri.to_string());
        for (key, value) in &parts.headers {
            builder = builder.header(key, value);
        }
        let resp = builder
            .body(body)
            .send()
            .await
            .map_err(|e| HttpError::Request(e.to_string()))?;

        let status = http::StatusCode::from_u16(resp.status().as_u16())
            .map_err(|e| HttpError::Http(e.into()))?;
        let mut rb = http::Response::builder().status(status);
        for (key, value) in resp.headers() {
            rb = rb.header(key, value);
        }
        let body = resp
            .bytes()
            .await
            .map_err(|e| HttpError::Request(e.to_string()))?
            .to_vec();
        Ok(rb.body(body)?)
    }
}

#[cfg(target_arch = "wasm32")]
impl HttpClient {
    async fn send_gloo(
        &self,
        req: http::Request<Vec<u8>>,
    ) -> Result<http::Response<Vec<u8>>, HttpError> {
        use gloo_net::http::RequestBuilder;

        let (parts, body) = req.into_parts();

        let mut builder = RequestBuilder::new(&parts.uri.to_string()).method(parts.method);
        for (key, value) in &parts.headers {
            builder = builder.header(
                key.as_str(),
                value
                    .to_str()
                    .map_err(|e| HttpError::Request(e.to_string()))?,
            );
        }
        if let Some(ua) = &self.user_agent {
            builder = builder.header("User-Agent", ua);
        }
        let builder = if body.is_empty() {
            builder.build()
        } else {
            let body_js = js_sys::Uint8Array::from(body.as_slice());
            builder.body(body_js)
        };
        let builder = builder.map_err(|e| HttpError::Request(e.to_string()))?;

        let resp = builder
            .send()
            .await
            .map_err(|e| HttpError::Request(e.to_string()))?;

        let status =
            http::StatusCode::from_u16(resp.status()).map_err(|e| HttpError::Http(e.into()))?;
        let mut rb = http::Response::builder().status(status);
        for (key, value) in resp.headers().entries() {
            rb = rb.header(&key, &value);
        }
        let body = resp
            .binary()
            .await
            .map_err(|e| HttpError::Request(e.to_string()))?;
        Ok(rb.body(body)?)
    }
}
