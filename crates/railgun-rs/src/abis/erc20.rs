#[cfg(not(target_arch = "wasm32"))]
use alloy::sol;
#[cfg(target_arch = "wasm32")]
use alloy_sol_types::sol;

#[cfg(not(target_arch = "wasm32"))]
sol! {
    #[sol(rpc)]
    // ERC20 interface
    contract ERC20 {
        function approve(address spender, uint256 amount) external returns (bool);
        function allowance(address owner, address spender) external view returns (uint256);
        function balanceOf(address account) external view returns (uint256);
    }
}

#[cfg(target_arch = "wasm32")]
sol! {
    // ERC20 interface
    contract ERC20 {
        function approve(address spender, uint256 amount) external returns (bool);
        function allowance(address owner, address spender) external view returns (uint256);
        function balanceOf(address account) external view returns (uint256);
    }
}
