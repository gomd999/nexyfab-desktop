<?php
/**
 * nexyfab Admin Dashboard - Inquiry Manager
 * Provides a date-sorted list of inquiries and a delete function.
 */

// 1. 보안 설정 - 간단한 비밀번호 체크 (원하시는 비밀번호로 변경하세요)
$admin_password = "ghksrud"; 
session_start();

if (isset($_GET['logout'])) {
    session_destroy();
    header("Location: " . $_SERVER['PHP_SELF']);
    exit;
}

if (!isset($_SESSION['admin_auth'])) {
    if (isset($_POST['password']) && $_POST['password'] === $admin_password) {
        $_SESSION['admin_auth'] = true;
    } else {
        ?>
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="robots" content="noindex, nofollow">
            <title>Admin Login - nexyfab</title>
            <style>
                body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; margin: 0; }
                .login-box { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
                input { padding: 10px; width: 200px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px; }
                button { padding: 10px 20px; background: #0b5cff; color: white; border: none; border-radius: 4px; cursor: pointer; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h2>Admin Access</h2>
                <form method="POST">
                    <input type="password" name="password" placeholder="Password" autofocus required><br>
                    <button type="submit">Login</button>
                </form>
            </div>
        </body>
        </html>
        <?php
        exit;
    }
}

// 2. 데이터 관리 로직
$data_file = 'inquiries.json';

// 데이터 로드
function load_data() {
    global $data_file;
    if (!file_exists($data_file)) {
        return [];
    }
    $json = file_get_contents($data_file);
    return json_decode($json, true) ?: [];
}

// 데이터 저장
function save_data($data) {
    global $data_file;
    file_put_contents($data_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// 삭제 처리
if (isset($_POST['delete_id'])) {
    $id_to_delete = $_POST['delete_id'];
    $data = load_data();
    $data = array_filter($data, function($item) use ($id_to_delete) {
        return $item['id'] !== $id_to_delete;
    });
    save_data(array_values($data));
    header("Location: " . $_SERVER['PHP_SELF']);
    exit;
}

$inquiries = load_data();

// CSV 엑셀 다운로드 처리
if (isset($_GET['export']) && $_GET['export'] === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=inquiries_' . date('Ymd') . '.csv');
    
    $output = fopen('php://output', 'w');
    // 엑셀에서 한글 깨짐 방지 (BOM 추가)
    fprintf($output, chr(0xEF).chr(0xBB).chr(0xBF));
    
    // 헤더 출력
    fputcsv($output, ['Date', 'Action', 'Name', 'Company', 'Email', 'Phone', 'Details']);
    
    foreach ($inquiries as $item) {
        $details = "";
        foreach ($item as $k => $v) {
            if (in_array($k, ['id', 'date', 'action', 'name', 'company', 'email', 'phone'])) continue;
            if (is_array($v)) $v = json_encode($v, JSON_UNESCAPED_UNICODE);
            $details .= "[$k] $v | ";
        }
        fputcsv($output, [
            $item['date'],
            $item['action'],
            $item['name'],
            $item['company'],
            $item['email'],
            $item['phone'],
            $details
        ]);
    }
    fclose($output);
    exit;
}

// 날짜 최신순으로 정렬
usort($inquiries, function($a, $b) {
    return strcmp($b['date'], $a['date']);
});
?>


<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Inquiry Management - nexyfab</title>
    <style>
        :root { --primary: #0b5cff; --text: #333; --bg: #f8fafc; }
        body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        h1 { margin: 0; font-size: 24px; color: var(--primary); }
        .logout-btn { text-decoration: none; color: #666; font-size: 14px; }
        
        .card { background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; padding: 15px; text-align: left; font-size: 13px; font-weight: 600; text-transform: uppercase; color: #64748b; }
        td { padding: 15px; border-bottom: 1px solid #f1f5f9; font-size: 14px; vertical-align: top; }
        tr:hover { background: #fbfcfe; }
        
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .type-inquiry { background: #e0f2fe; color: #0369a1; }
        .type-partner { background: #f0fdf4; color: #166534; }
        .type-order { background: #fff7ed; color: #9a3412; }
        
        .delete-btn { background: #fee2e2; color: #b91c1c; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .delete-btn:hover { background: #fecaca; }
        
        .details-box { font-size: 12px; color: #666; white-space: pre-wrap; margin-top: 5px; background: #f9fafb; padding: 8px; border-radius: 4px; }
        .empty { text-align: center; padding: 50px; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Inquiry Manager</h1>
            <div style="display: flex; align-items: center; gap: 15px;">
                <a href="?export=csv" style="text-decoration: none; background: #22c55e; color: white; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;">Excel 다운로드 (.csv)</a>
                <span style="font-size: 14px; color: #666;">Admin Logged In</span>
                <a href="?logout=1" class="logout-btn">Logout</a>
            </div>
        </header>


        <div class="card">
            <table>
                <thead>
                    <tr>
                        <th style="width: 150px;">Date</th>
                        <th style="width: 120px;">Type</th>
                        <th style="width: 180px;">User / Company</th>
                        <th>Details</th>
                        <th style="width: 80px;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($inquiries)): ?>
                        <tr><td colspan="5" class="empty">No inquiries found.</td></tr>
                    <?php else: ?>
                        <?php foreach ($inquiries as $item): ?>
                            <tr>
                                <td><?php echo htmlspecialchars($item['date']); ?></td>
                                <td>
                                    <?php 
                                        $cls = 'type-inquiry';
                                        if (strpos($item['action'], 'partner') !== false) $cls = 'type-partner';
                                        if (strpos($item['action'], 'order') !== false) $cls = 'type-order';
                                        echo "<span class='badge $cls'>" . strtoupper(str_replace('send_', '', $item['action'])) . "</span>";
                                    ?>
                                </td>
                                <td>
                                    <strong><?php echo htmlspecialchars($item['name']); ?></strong><br>
                                    <span style="color: #666; font-size: 12px;"><?php echo htmlspecialchars($item['company']); ?></span><br>
                                    <span style="color: #999; font-size: 11px;"><?php echo htmlspecialchars($item['email']); ?></span>
                                </td>
                                <td>
                                    <div class="details-box"><?php 
                                        // 주요 필드들 표시
                                        foreach ($item as $key => $val) {
                                            if (in_array($key, ['id', 'date', 'action', 'name', 'company', 'email', 'phone'])) continue;
                                            if (is_array($val)) $val = json_encode($val, JSON_UNESCAPED_UNICODE);
                                            echo "<strong>" . ucfirst($key) . "</strong>: " . htmlspecialchars($val) . "\n";
                                        }
                                    ?></div>
                                </td>
                                <td>
                                    <form method="POST" onsubmit="return confirm('진짜 삭제하시겠습니까?');">
                                        <input type="hidden" name="delete_id" value="<?php echo htmlspecialchars($item['id']); ?>">
                                        <button type="submit" class="delete-btn">Delete</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>
