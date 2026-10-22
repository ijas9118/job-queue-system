# Pattern 9: Real-Time Updates (WebSocket)

## The Problem

**Polling**: Dashboard refreshes every second.

```
User submits job
Dashboard: "Is it done yet?" (query API)
API: "Nope"

1 second later:
Dashboard: "Is it done yet?" (query API)
API: "Nope"

... repeat hundreds of times ...

Result: Wasted network requests, stale data
```

## The Solution: WebSocket Push

Server pushes updates to clients (no polling).

```
User submits job
Server: "Job started" → Push to client
Dashboard updates immediately

User sees progress without refreshing
No wasted requests
Real-time feel
```

## Implementation

### Server Side (API)

```typescript
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:3001' },
});

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  // Client subscribes to job updates
  socket.on('subscribe', ({ channel, filters }) => {
    const room = `${channel}:${JSON.stringify(filters)}`;
    socket.join(room);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected');
  });
});

// When job status changes, broadcast to subscribers
export function broadcastJobUpdate(job: Job) {
  io.to(`jobs:${job.userId}`).emit('job:updated', job);
}
```

### Client Side (Dashboard)

Via Angular's `SocketService` + `JobsService` (RxJS-wrapped socket, signal-backed state) — see [[COMPONENTS/03-Dashboard]] for the full implementation:

```typescript
// JobsService, constructed once, injected wherever job state is needed
this.socket.connect(this.auth.accessToken()!);
this.socket.emit('subscribe', { channel: 'jobs', filters: { userId: this.auth.user()?.id } });

this.socket
  .on<Job>('job:created')
  .subscribe((job) => this.jobsSubject.next([job, ...this.jobsSubject.value]));

this.socket
  .on<{ jobId: string }>('job:started')
  .subscribe((data) =>
    this.jobsSubject.next(
      this.jobsSubject.value.map((j) => (j.id === data.jobId ? { ...j, status: 'active' } : j))
    )
  );

this.socket
  .on<{ jobId: string; progress: number }>('job:progress')
  .subscribe((data) =>
    this.jobsSubject.next(
      this.jobsSubject.value.map((j) =>
        j.id === data.jobId ? { ...j, progress: data.progress } : j
      )
    )
  );

this.socket
  .on<Job>('job:completed')
  .subscribe((job) =>
    this.jobsSubject.next(this.jobsSubject.value.map((j) => (j.id === job.id ? job : j)))
  );
```

## Events

### Job Events

```
job:created        → New job submitted
job:started        → Worker picked it up
job:progress       → Progress update (for long jobs)
job:completed      → Successfully finished
job:failed         → Temporary failure
job:retry_scheduled → Retry scheduled
job:dead_letter    → Moved to DLQ
job:cancelled      → User cancelled
job:paused         → Admin paused
```

### Worker Events

```
worker:online      → Worker came online
worker:offline     → Worker went offline
worker:status      → Status changed (busy/idle)
```

### Queue Events

```
queue:stats        → Queue metrics (every 5s)
```

## Benefits

| Benefit           | How                                |
| ----------------- | ---------------------------------- |
| **Real-time**     | Updates push immediately           |
| **Efficient**     | No polling overhead                |
| **Interactive**   | Users see changes instantly        |
| **Scalable**      | Socket.IO handles many connections |
| **Bidirectional** | Client can send, server can send   |

## Testing

```typescript
describe('WebSocket Updates', () => {
  it('broadcasts job:completed event', (done) => {
    const socket = io('http://localhost:3000');

    socket.on('connect', () => {
      socket.emit('subscribe', { channel: 'jobs' });
    });

    socket.on('job:completed', (job) => {
      expect(job.status).toBe('completed');
      socket.disconnect();
      done();
    });

    // Simulate job completion
    broadcastJobUpdate({ ...job, status: 'completed' });
  });

  it('only sends updates to subscribed clients', (done) => {
    // Client 1 subscribes to jobs
    const socket1 = io('http://localhost:3000');
    // Client 2 subscribes to workers
    const socket2 = io('http://localhost:3000');

    socket1.on('connect', () => {
      socket1.emit('subscribe', { channel: 'jobs' });
    });

    socket2.on('connect', () => {
      socket2.emit('subscribe', { channel: 'workers' });
    });

    socket1.on('job:completed', () => {
      // Socket1 gets it
      expect(true).toBe(true);
    });

    socket2.on('job:completed', () => {
      // Socket2 doesn't get it
      fail('Should not receive job events');
    });

    broadcastJobUpdate(job);
  });
});
```

## Related Documentation

- [[WEBSOCKET]] - Full WebSocket documentation
- [[COMPONENTS/03-Dashboard]] - WebSocket usage
- [[COMPONENTS/01-API-Service]] - Broadcasts events
