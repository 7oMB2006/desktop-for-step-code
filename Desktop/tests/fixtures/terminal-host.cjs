process.on('message', message => {
  if (message.type === 'start') {
    setTimeout(() => process.send({ type: 'ready' }), process.cwd().endsWith('delayed') ? 1000 : 0);
  } else if (message.type === 'write') {
    if (message.data === 'exit') {
      process.send({ type: 'exit', exitCode: 7 }, () => process.disconnect());
    } else {
      for (let seq = 1; seq <= 5; seq++) process.send({ type: 'data', seq, data: 'x'.repeat(128 * 1024) });
    }
  }
});
process.on('disconnect', () => process.exit(0));
