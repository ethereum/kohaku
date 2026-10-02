import { ComboBlocklist, SecurityAllianceBlocklist, MetamaskBlocklist } from "../src/index";

// Create a combo blocklist that aggregates from SEAL and Metamask
const blocklist = new ComboBlocklist([
    new SecurityAllianceBlocklist(),
    new MetamaskBlocklist(),
]);

// Check if an address is blocked
const addressStatus = await blocklist.isAddressBlocked("0x000000000000000000000000000000000000dead");
console.log(addressStatus);

// Check if a URL is blocked
const urlStatus = await blocklist.isOriginBlocked("https://phishing-site.com");
console.log(urlStatus);
