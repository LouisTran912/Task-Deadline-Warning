## Task ETA & Risk

# What it is
A lightweight Forge app for Jira Cloud that lets assignees enter a time estimate for an issue and shows risk warnings against the due date and overall workload.

# Key features

Per-issue estimate: input “Hours remaining” (or store an ETA behind the scenes).

Per-issue risk: warns if your estimate likely misses the due date or has <1 day buffer.

Portfolio risk: sums estimates across all your open assigned issues and compares to the time budget until the furthest due date (flags TIGHT or OVERBOOKED).

On-track banner: green confirmation when both per-issue and portfolio are OK.

# How it works

Estimates are saved on the issue as a Jira Issue Property: com.tasketa.estimate
(e.g., { remainingHours: 6, updatedAt: "…" }).

Per-issue risk compares your ETA/remaining hours to the issue’s duedate.

Portfolio risk uses JQL to fetch your open assigned issues, sums their estimates, and compares against (furthest due date − now).

# Usage

Open any issue (with a due date).

In the “Task ETA & Risk” panel, enter Hours remaining → Save.

Read the banner(s):

Green “Everything is on track” = you’re good.

Warning/Error = adjust estimates, priorities, or due dates.

# Install for testing

Share link: https://developer.atlassian.com/console/install/6f137dc9-1a67-4fbe-b85f-995f31c5d806?signature=AYABeNzdPMApMzU%2BSeBOamSjhxUAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy1lYXN0LTE6NzA5NTg3ODM1MjQzOmtleS83ZjcxNzcxZC02OWM4LTRlOWItYWU5Ny05MzJkMmNhZjM0NDIAuAECAQB4KVgoNesMySI2pXEz4J5S%2B4but%2FgpPvEEG0vL8V0Jz5cBJbWLibsmKw5%2BxsRfqjov%2FwAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDIB%2BVeeE0T%2FbNZdSwwIBEIA7%2BZwKAZut93k2v3VjfKzzUXOFAsXpLqFjEuwcWL5RSG1S2SPYiuvQFGy%2F3Ga6RFmWg%2Bw0j5IN%2BOy32yAAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzU1OWQ0NTE2LWE3OTEtNDdkZi1iYmVkLTAyNjFlODY4ZWE1YwC4AQICAHig7hOcRWe1S%2BcRRsjD9q0WpZcapmXa1oPX3jm4ao883gGyptTcgebHITYxASoXQhdHAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMpEGmsv0IwdDfnKkSAgEQgDv9NYBNPKGU1Oc%2BoD2gKw1pJDFGckYKh5%2BD0YV4XUnqIpcDlKhiBDcH6aq94H2tWDw5OnWVBVCr8I74swAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtd2VzdC0yOjcwOTU4NzgzNTI0MzprZXkvM2M0YjQzMzctYTQzOS00ZmNhLWEwZDItNDcyYzE2ZWRhZmRjALgBAgIAeBeusbAYURagY7RdQhCHwxFswh7l65V7cwKp%2BDc1WGoHAc%2BSRl0DE3NixD6GzM0%2FRPkAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAxBUw203j2h6hr3G7ICARCAOw3GxkUfE4FcDF2n1QPI6TaUbUK%2FUXYU8LIzXP7IN3zcaLZdDw0Xr1B3nv%2FmULmoVMw8UjiDEjcIhNAkAgAAAAAMAAAQAAAAAAAAAAAAAAAAAJncbRhCbA3a6eErptloQ7H%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLR6F8oLPt7O4qD%2FrG1I8kkKj0yEbVyYJNnSDjMVg6Z10Ek8sIXBTHgG0ZsgJjF4pzeHb0QFIt2pK2TZ7PdEAFkgxE%3D&product=jira

CLI (if you’re an admin on the site):

forge deploy -e development
forge install -e development --site <your-site>.atlassian.net --product jira


After code changes:

forge deploy -e development
forge install --upgrade -e development --site <your-site>.atlassian.net --product jira

Permissions & storage

Scopes: read:jira-work, write:jira-work.

Reads may occur asUser (respect current user permissions); issue properties are written asApp.

No external databases; data stays in your Jira Cloud site (issue properties).

Notes / limitations

Works best when issues have duedate.

Issue property value must be small (< ~32 KB)—we store only a tiny JSON.

Portfolio risk is a simple heuristic; it doesn’t account for calendars, work hours, or parallelism.

# Privacy

The app reads basic issue fields and stores your estimate inside your Jira site.

No analytics, no third-party storage. For demo/evaluation use.

# Contact: Louis Tran • contact@louistran.ca
