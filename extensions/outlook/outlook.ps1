# Read-only bridge to classic Outlook (COM) for extensions/outlook/index.ts.
# Keep this file pure ASCII: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.
# The request arrives as one base64 JSON argument because PS 5.1 mangles quotes in -File arguments.
# Never call $outlook.Quit(): it would close the user's own Outlook window.
param([string]$Request)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$MAX_FOLDERS_SCANNED = 300
$MAIL_ITEM = 0  # olMailItem as a folder's DefaultItemType

# Aliases work on non-English Outlook because they map to default-folder constants, not names.
$DEFAULT_FOLDERS = @{
	'inbox' = 6; 'sent' = 5; 'sent items' = 5; 'sent mail' = 5; 'drafts' = 16
	'deleted' = 3; 'deleted items' = 3; 'trash' = 3; 'junk' = 23; 'junk email' = 23; 'outbox' = 4
}

function Fail([string]$msg) {
	[Console]::Error.Write("outlook: $msg")
	exit 2
}

function Escape-Dasl([string]$s) {
	# Single quotes are doubled inside DASL string literals.
	return $s.Replace("'", "''")
}

function Like([string]$prop, [string]$value) {
	return "`"$prop`" LIKE '%$(Escape-Dasl $value)%'"
}

function Build-DaslFilter($req) {
	$parts = @()
	if ($req.subject) { $parts += Like 'urn:schemas:httpmail:subject' $req.subject }
	if ($req.from) {
		$parts += '(' + (Like 'urn:schemas:httpmail:fromname' $req.from) + ' OR ' + (Like 'urn:schemas:httpmail:fromemail' $req.from) + ')'
	}
	if ($req.to) {
		$parts += '(' + (Like 'urn:schemas:httpmail:displayto' $req.to) + ' OR ' + (Like 'urn:schemas:httpmail:displaycc' $req.to) + ')'
	}
	if ($req.text) {
		$parts += '(' + (Like 'urn:schemas:httpmail:subject' $req.text) + ' OR ' + (Like 'urn:schemas:httpmail:textdescription' $req.text) + ')'
	}
	if ($parts.Count -eq 0) { return $null }
	return '@SQL=' + ($parts -join ' AND ')
}

function Clean-Path([string]$folderPath) {
	# COM gives "\\alexa@corp.com\Inbox\Clients"; tools use "alexa@corp.com/Inbox/Clients".
	return $folderPath.TrimStart('\').Replace('\', '/')
}

# Dot-sourcing (". outlook.ps1") loads the functions above for tests without touching Outlook.
if ($MyInvocation.InvocationName -eq '.') { return }

function Get-Namespace {
	try {
		$outlook = New-Object -ComObject Outlook.Application
		return $outlook.GetNamespace('MAPI')
	} catch {
		Fail ("classic Outlook (desktop) is not installed or cannot be automated. " +
			"New Outlook does not support this: switch the 'New Outlook' toggle off. Details: $($_.Exception.Message)")
	}
}

function Find-Child($parent, [string]$name) {
	foreach ($f in $parent.Folders) { if ($f.Name -ieq $name) { return $f } }
	return $null
}

function Resolve-Folder($ns, [string]$path) {
	if (-not $path) { $path = 'inbox' }
	$segments = @($path -split '[/\\]' | Where-Object { $_ -ne '' })
	$defaultRoot = $ns.GetDefaultFolder(6).Parent
	if ($segments.Count -eq 0 -or $segments[0] -ieq 'all') { return $defaultRoot }

	$first = $segments[0].ToLower()
	$current = $null
	if ($DEFAULT_FOLDERS.ContainsKey($first)) {
		$current = $ns.GetDefaultFolder($DEFAULT_FOLDERS[$first])
	} else {
		foreach ($store in $ns.Folders) { if ($store.Name -ieq $segments[0]) { $current = $store } }
		if (-not $current) { $current = Find-Child $defaultRoot $segments[0] }
	}
	if (-not $current) {
		$tops = @($defaultRoot.Folders | ForEach-Object { $_.Name }) -join ', '
		Fail "folder '$($segments[0])' not found. Top-level folders: $tops. Use outlook_folders to see all paths."
	}
	for ($i = 1; $i -lt $segments.Count; $i++) {
		$next = Find-Child $current $segments[$i]
		if (-not $next) {
			$kids = @($current.Folders | ForEach-Object { $_.Name }) -join ', '
			if (-not $kids) { $kids = '(none)' }
			Fail "subfolder '$($segments[$i])' not found in '$(Clean-Path $current.FolderPath)'. Its subfolders: $kids"
		}
		$current = $next
	}
	return $current
}

function Get-MailFolders($root, [int]$maxDepth) {
	$out = New-Object System.Collections.ArrayList
	$queue = New-Object System.Collections.Queue
	$queue.Enqueue(@($root, 0))
	while ($queue.Count -gt 0 -and $out.Count -lt $MAX_FOLDERS_SCANNED) {
		$f, $depth = $queue.Dequeue()
		if ($f.DefaultItemType -eq $MAIL_ITEM) { [void]$out.Add($f) }
		if ($depth -lt $maxDepth) { foreach ($c in $f.Folders) { $queue.Enqueue(@($c, ($depth + 1))) } }
	}
	return , $out
}

function Effective-Date($item) {
	# Unsent items (drafts) carry ReceivedTime 4501-01-01.
	$d = $item.ReceivedTime
	if ($d.Year -ge 4500) { $d = $item.CreationTime }
	return $d
}

function Preview([string]$body, [int]$n) {
	$t = ($body -replace '\s+', ' ').Trim()
	if ($t.Length -gt $n) { return $t.Substring(0, $n) + '...' }
	return $t
}

function Smtp-Of($item) {
	try {
		if ($item.SenderEmailType -eq 'EX') {
			$u = $item.Sender.GetExchangeUser()
			if ($u) { return $u.PrimarySmtpAddress }
		}
		return $item.SenderEmailAddress
	} catch { return '' }
}

function Action-Folders($ns, $req) {
	$roots = @()
	if ($req.mailbox) {
		foreach ($store in $ns.Folders) { if ($store.Name -ilike "*$($req.mailbox)*") { $roots += $store } }
		if ($roots.Count -eq 0) {
			$names = @($ns.Folders | ForEach-Object { $_.Name }) -join ', '
			Fail "no mailbox matches '$($req.mailbox)'. Mailboxes: $names"
		}
	} else {
		foreach ($store in $ns.Folders) { $roots += $store }
	}
	$depth = 10
	if ($req.max_depth) { $depth = [int]$req.max_depth }
	$rows = @()
	foreach ($r in $roots) {
		$rows += @{ path = (Clean-Path $r.FolderPath); count = -1 }
		foreach ($f in (Get-MailFolders $r $depth)) {
			if ($f.EntryID -eq $r.EntryID) { continue }
			$rows += @{ path = (Clean-Path $f.FolderPath); count = $f.Items.Count }
		}
	}
	return @{ folders = $rows; capped = ($rows.Count -ge $MAX_FOLDERS_SCANNED) }
}

function Action-Search($ns, $req) {
	$limit = 10
	if ($req.limit) { $limit = [Math]::Min([int]$req.limit, 50) }
	$since = $null; $until = $null
	try {
		if ($req.since) { $since = [datetime]::Parse($req.since, [Globalization.CultureInfo]::InvariantCulture) }
		if ($req.until) { $until = [datetime]::Parse($req.until, [Globalization.CultureInfo]::InvariantCulture) }
	} catch { Fail "since/until must look like 2025-05-31 or 2025-05-31 14:00" }
	# A date-only "until" means the whole day.
	if ($until -and $req.until -notmatch ':') { $until = $until.AddDays(1).AddSeconds(-1) }

	$root = Resolve-Folder $ns $req.folder
	$recurse = [bool]$req.include_subfolders -or ($req.folder -ieq 'all')
	if ($recurse) { $folders = Get-MailFolders $root 20 } else { $folders = @($root) }
	$filter = Build-DaslFilter $req

	$hits = New-Object System.Collections.ArrayList
	foreach ($f in $folders) {
		if ($f.DefaultItemType -ne $MAIL_ITEM) { continue }
		$items = $f.Items
		if ($filter) {
			try { $items = $items.Restrict($filter) } catch { Fail "Outlook rejected the search filter: $($_.Exception.Message)" }
		}
		$items.Sort('[ReceivedTime]', $true)
		$found = 0
		$it = $items.GetFirst()
		while ($it -and $found -lt $limit) {
			try {
				# Only the sort key may stop the loop: drafts sort first with a fake 4501 ReceivedTime.
				if ($since -and $it.ReceivedTime -lt $since) { break }
				$d = Effective-Date $it
				if ((-not $until -or $d -le $until) -and (-not $since -or $d -ge $since)) {
					[void]$hits.Add(@{
						entry_id = $it.EntryID; store_id = $f.StoreID
						date = $d.ToString('yyyy-MM-dd HH:mm'); sort = $d.Ticks
						from = $it.SenderName; to = $it.To; subject = $it.Subject
						folder = (Clean-Path $f.FolderPath); attachments = $it.Attachments.Count
						preview = (Preview $it.Body 150)
					})
					$found++
				}
			} catch { }  # meeting receipts, reports etc. lack some mail properties
			$it = $items.GetNext()
		}
	}
	$sorted = @($hits | Sort-Object { $_.sort } -Descending | Select-Object -First $limit)
	foreach ($h in $sorted) { $h.Remove('sort') }
	return @{
		results = $sorted; folder = (Clean-Path $root.FolderPath); folders_searched = @($folders).Count
		more_may_exist = ($hits.Count -gt $limit -or @($folders).Count -ge $MAX_FOLDERS_SCANNED)
	}
}

function Action-Read($ns, $req) {
	if (-not $req.entry_id) { Fail 'missing id' }
	try {
		if ($req.store_id) { $m = $ns.GetItemFromID($req.entry_id, $req.store_id) } else { $m = $ns.GetItemFromID($req.entry_id) }
	} catch { Fail "email not found (it may have been moved or deleted). Search again. Details: $($_.Exception.Message)" }
	$max = 8000
	if ($req.max_chars) { $max = [int]$req.max_chars }
	$body = [string]$m.Body
	$atts = @()
	foreach ($a in $m.Attachments) { $atts += @{ name = $a.FileName; size = $a.Size } }
	$d = Effective-Date $m
	return @{
		subject = $m.Subject; from = $m.SenderName; from_email = (Smtp-Of $m)
		to = $m.To; cc = $m.CC; date = $d.ToString('yyyy-MM-dd HH:mm')
		folder = (Clean-Path $m.Parent.FolderPath); attachments = $atts
		body = $(if ($body.Length -gt $max) { $body.Substring(0, $max) } else { $body })
		body_length = $body.Length; truncated = ($body.Length -gt $max)
	}
}

try {
	$req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request)) | ConvertFrom-Json
} catch { Fail 'bad request (expected base64 JSON)' }

$ns = Get-Namespace
switch ($req.action) {
	'folders' { $result = Action-Folders $ns $req }
	'search' { $result = Action-Search $ns $req }
	'read' { $result = Action-Read $ns $req }
	default { Fail "unknown action '$($req.action)'" }
}
[Console]::Out.Write(($result | ConvertTo-Json -Depth 6 -Compress))
