pub fn fee_content_topic(chain_id: u64) -> String {
    format!("/railgun/v2/0-{}-fees/json", chain_id)
}

pub fn transact_content_topic(chain_id: u64) -> String {
    format!("/railgun/v2/0-{}-transact/json", chain_id)
}

pub fn transact_response_content_topic(chain_id: u64) -> String {
    format!("/railgun/v2/0-{}-transact-response/json", chain_id)
}
