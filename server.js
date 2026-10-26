app.post('/api/admin/users/:id/coins', adminOnly, (req, res) => {
  const id = +req.params.id;
  const coins = parseInt(req.body.coins);
  if (isNaN(coins)) return res.status(400).json({ error: 'Số xu không hợp lệ' });

  db.prepare('UPDATE users SET coins=? WHERE id=?').run(coins, id);
  
  // Cập nhật realtime cho người chơi nếu họ đang online
  io.to(`u:${id}`).emit('state', getState(id));
  
  res.json({ ok: true, coins });
});
