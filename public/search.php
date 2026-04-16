<?php
header('Content-Type: application/json; charset=utf-8');

$q = isset($_GET['q']) ? trim($_GET['q']) : '';

if (empty($q)) {
    echo json_encode(['ko' => [], 'cn' => []]);
    exit;
}

$db_path = __DIR__ . '/data/factories.db';
if (!file_exists($db_path)) {
    echo json_encode(['error' => 'Database not found', 'ko' => [], 'cn' => []]);
    exit;
}

try {
    $db = new SQLite3($db_path, SQLITE3_OPEN_READONLY);
} catch (Exception $e) {
    echo json_encode(['error' => 'Failed to open database', 'ko' => [], 'cn' => []]);
    exit;
}

$query = mb_strtolower($q, 'UTF-8');
$keywords = preg_split('/\s+/', $query, -1, PREG_SPLIT_NO_EMPTY);

$results_ko = [];
$results_cn = [];

/**
 * Score calculation function
 */
function getScore($item, $query, $keywords) {
    $score = 0;
    
    // Core searchable fields
    $searchFields = [
        $item['name'], $item['name_en'], $item['name_cn'],
        $item['product'], $item['product_en'], $item['product_ja'], $item['product_cn'],
        $item['industry'], $item['industry_en'], $item['industry_ja'], $item['industry_cn'],
        $item['category'], $item['category_en'], $item['category_ja'], $item['category_cn']
    ];
    
    $searchFields = array_map(function($f) {
        return mb_strtolower($f ?? '', 'UTF-8');
    }, $searchFields);

    // 1. Exact full phrase match (Top priority)
    foreach ($searchFields as $field) {
        if ($field === $query) {
            $score += 1000; // Perfect match
        } else if (strpos($field, $query) === 0) {
            $score += 500;  // Starts with the full phrase
        } else if (strpos($field, $query) !== false) {
            $score += 300;  // Contains the full phrase
        }
    }

    // 2. Individual keyword hits frequency and combinations
    $hitCount = 0;
    foreach ($keywords as $kw) {
        $foundInItem = false;
        foreach ($searchFields as $field) {
            if ($field === $kw) {
                $score += 200;
                $foundInItem = true;
            } else if (strpos($field, $kw) === 0) {
                $score += 100;
                $foundInItem = true;
            } else if (strpos($field, $kw) !== false) {
                $score += 50;
                $foundInItem = true;
            }
        }
        if ($foundInItem) $hitCount++;
    }
    
    // Multi-keyword bonus (Significant boost for satisfying all search terms)
    if ($hitCount === count($keywords) && count($keywords) > 1) {
        $score += 400; 
    } else if ($hitCount > 1) {
        $score += ($hitCount * 100);
    }

    // 3. Name Match Bonus (Usually what people look for first)
    $nameFields = [
        mb_strtolower($item['name'] ?? '', 'UTF-8'),
        mb_strtolower($item['name_en'] ?? '', 'UTF-8'),
        mb_strtolower($item['name_cn'] ?? '', 'UTF-8')
    ];
    foreach ($nameFields as $nf) {
        if ($nf === $query) $score += 1000;
        else if (strpos($nf, $query) === 0) $score += 500;
        else if (strpos($nf, $query) !== false) $score += 300;
    }

    return $score;
}

/**
 * Enhanced Search Helper
 * If AND search yields too few results, it performs OR search to show broader matches
 */
function performSearch($db, $country, $keywords, $query) {
    $results = [];
    
    // Attempt 1: Strict BROAD search (All keywords present anywhere in search_text)
    $where_clauses = [];
    foreach ($keywords as $kw) {
        $escaped = SQLite3::escapeString($kw);
        $where_clauses[] = "search_text LIKE '%$escaped%'";
    }
    $where_str = implode(' AND ', $where_clauses);
    
    $sql = "SELECT * FROM factories WHERE country='$country' AND ($where_str) LIMIT 200";
    $res = $db->query($sql);
    
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
        $score = getScore($row, $query, $keywords);
        if ($score > 0) {
            $row['score'] = $score;
            $results[] = $row;
        }
    }
    
    // Attempt 2: If we have very few results, perform OR search (any keyword)
    if (count($results) < 10 && count($keywords) > 1) {
        $or_clauses = [];
        foreach ($keywords as $kw) {
            $escaped = SQLite3::escapeString($kw);
            $or_clauses[] = "search_text LIKE '%$escaped%'";
        }
        $or_str = implode(' OR ', $or_clauses);
        $sql_or = "SELECT * FROM factories WHERE country='$country' AND ($or_str) AND NOT ($where_str) LIMIT 100";
        $res_or = $db->query($sql_or);
        
        while ($row = $res_or->fetchArray(SQLITE3_ASSOC)) {
            $score = getScore($row, $query, $keywords);
            if ($score > 0) {
                $row['score'] = $score;
                $results[] = $row;
            }
        }
    }
    
    // Sort by score
    usort($results, function($a, $b) { return $b['score'] - $a['score']; });
    
    // Take top 40 (displaying more results to the user)
    return array_slice($results, 0, 40);
}

$results_ko = performSearch($db, 'KO', $keywords, $query);
$results_cn = performSearch($db, 'CN', $keywords, $query);

// Cleanup items for output
$cleanup = function($list) {
    return array_map(function($item) {
        unset($item['score']);
        unset($item['search_text']);
        unset($item['id']);
        return $item;
    }, $list);
};

echo json_encode([
    'ko' => $cleanup($results_ko),
    'cn' => $cleanup($results_cn)
]);

$db->close();
?>
