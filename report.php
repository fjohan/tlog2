<?php
header('Content-Type: application/json');

$input = file_get_contents('php://input');
if (!$input) {
  http_response_code(400);
  echo json_encode(['error' => 'Empty request']);
  exit;
}

$data = json_decode($input, true);
if (!is_array($data)) {
  http_response_code(400);
  echo json_encode(['error' => 'Invalid JSON']);
  exit;
}

$dir = __DIR__ . '/reports';
if (!is_dir($dir)) {
  @mkdir($dir, 0775, true);
}

if (!is_dir($dir)) {
  http_response_code(500);
  $err = error_get_last();
  echo json_encode(['error' => 'Failed to create reports directory', 'detail' => $err ? $err['message'] : null]);
  exit;
}

if (!is_writable($dir)) {
  http_response_code(500);
  echo json_encode([
    'error' => 'Reports directory not writable',
    'path' => $dir
  ]);
  exit;
}

$noteId = isset($data['noteId']) ? preg_replace('/[^a-zA-Z0-9_-]+/', '_', $data['noteId']) : 'note';
$timestamp = gmdate('Ymd_His');
$filename = $dir . '/report_' . $noteId . '_' . $timestamp . '.json';

$encoded = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
if ($encoded === false) {
  http_response_code(500);
  echo json_encode(['error' => 'Failed to encode report', 'detail' => json_last_error_msg()]);
  exit;
}

if (@file_put_contents($filename, $encoded) === false) {
  http_response_code(500);
  $err = error_get_last();
  echo json_encode(['error' => 'Failed to write report', 'detail' => $err ? $err['message'] : null]);
  exit;
}

$relative = 'reports/' . basename($filename);
http_response_code(200);
echo json_encode(['ok' => true, 'path' => $relative]);
