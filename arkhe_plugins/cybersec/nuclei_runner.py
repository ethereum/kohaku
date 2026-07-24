def run_educational_templates(url, test_type):
    # This simulates a wrapper around nuclei executing templates for educational purposes.
    results = []
    if test_type in ["sqli", "all"]:
        results.append({
            "name": "SQL Injection Detected (Educational)",
            "severity": "critical",
            "remediation": "Use parameterized queries or prepared statements."
        })
    if test_type in ["xss", "all"]:
        results.append({
            "name": "Reflected XSS Detected (Educational)",
            "severity": "high",
            "remediation": "Escape user input before rendering."
        })
    if test_type in ["upload", "all"]:
        results.append({
            "name": "Unrestricted File Upload (Educational)",
            "severity": "high",
            "remediation": "Validate file extensions and MIME types. Do not execute uploaded files."
        })
    return results
