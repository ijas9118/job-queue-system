# WebSocket Events

## Connection

```typescript
import { io } from 'socket.io-client';

// accessToken comes from AuthService's in-memory signal — never localStorage.
// See [[COMPONENTS/03-Dashboard]] and [[API/01-Authentication]].
const socket = io('http://localhost:3000', {
  auth: { token: authService.accessToken() },
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

## Subscription

```typescript
// Subscribe to job updates
socket.emit('subscribe', {
  channel: 'jobs',
  filters: { userId: currentUser.id },
});

// Subscribe to worker updates
socket.emit('subscribe', {
  channel: 'workers',
});

// Subscribe to queue stats
socket.emit('subscribe', {
  channel: 'queue-stats',
});
```

## Job Events

### job:created

Emitted when a new job is submitted.

```typescript
socket.on('job:created', (data) => {
  console.log('New job:', data);
  // {
  //   jobId: "uuid",
  //   type: "send-email",
  //   status: "queued",
  //   createdAt: "2026-07-02T10:00:00Z"
  // }
});
```

### job:started

Emitted when a worker picks up a job.

```typescript
socket.on('job:started', (data) => {
  // {
  //   jobId: "uuid",
  //   workerId: "worker-1",
  //   startedAt: "2026-07-02T10:00:01Z"
  // }
});
```

### job:progress

Emitted periodically for long-running jobs.

```typescript
socket.on('job:progress', (data) => {
  // {
  //   jobId: "uuid",
  //   progress: 45,  // 0-100
  //   message: "Processing file chunk 5/10"
  // }
});
```

### job:completed

Emitted when a job succeeds.

```typescript
socket.on('job:completed', (data) => {
  // {
  //   jobId: "uuid",
  //   status: "completed",
  //   result: { messageId: "msg-123" },
  //   duration: 2345,  // milliseconds
  //   completedAt: "2026-07-02T10:00:03Z"
  // }
});
```

### job:failed

Emitted when a job fails (transient).

```typescript
socket.on('job:failed', (data) => {
  // {
  //   jobId: "uuid",
  //   errorType: "SMTPTimeout",
  //   errorMessage: "Connection timeout",
  //   retryCount: 1,
  //   nextRetryAt: "2026-07-02T10:00:04Z",
  //   failedAt: "2026-07-02T10:00:02Z"
  // }
});
```

### job:retry_scheduled

Emitted when a retry is scheduled after failure.

```typescript
socket.on('job:retry_scheduled', (data) => {
  // {
  //   jobId: "uuid",
  //   attempt: 2,
  //   delayMs: 4000,
  //   scheduledFor: "2026-07-02T10:00:06Z"
  // }
});
```

### job:dead_letter

Emitted when a job moves to DLQ.

```typescript
socket.on('job:dead_letter', (data) => {
  // {
  //   jobId: "uuid",
  //   reason: "Max retries exceeded (3/3)",
  //   movedAt: "2026-07-02T10:00:30Z"
  // }
});
```

### job:cancelled

Emitted when a user cancels a job.

```typescript
socket.on('job:cancelled', (data) => {
  // {
  //   jobId: "uuid",
  //   cancelledAt: "2026-07-02T10:05:00Z"
  // }
});
```

### job:paused

Emitted when admin pauses a job.

```typescript
socket.on('job:paused', (data) => {
  // {
  //   jobId: "uuid",
  //   pausedAt: "2026-07-02T10:05:00Z"
  // }
});
```

### job:log

Emitted for each log line in execution.

```typescript
socket.on('job:log', (data) => {
  // {
  //   jobId: "uuid",
  //   executionId: "exec-uuid",
  //   level: "INFO",
  //   message: "Email sent successfully",
  //   metadata: { messageId: "msg-123" },
  //   createdAt: "2026-07-02T10:00:10Z"
  // }
});
```

## Worker Events

### worker:online

Emitted when a worker comes online.

```typescript
socket.on('worker:online', (data) => {
  // {
  //   workerId: "worker-1",
  //   hostname: "localhost",
  //   status: "idle",
  //   startedAt: "2026-07-02T09:00:00Z"
  // }
});
```

### worker:offline

Emitted when a worker goes offline.

```typescript
socket.on('worker:offline', (data) => {
  // {
  //   workerId: "worker-1",
  //   lastHeartbeat: "2026-07-02T10:15:30Z"
  // }
});
```

### worker:status

Emitted when worker status changes (idle → busy or vice versa).

```typescript
socket.on('worker:status', (data) => {
  // {
  //   workerId: "worker-1",
  //   status: "busy",
  //   currentJobId: "job-123",
  //   updatedAt: "2026-07-02T10:00:05Z"
  // }
});
```

## Queue Events

### queue:stats

Emitted every 5 seconds with queue metrics.

```typescript
socket.on('queue:stats', (data) => {
  // {
  //   queueName: "email",
  //   waiting: 145,
  //   active: 3,
  //   delayed: 12,
  //   failed: 5,
  //   completed: 8234,
  //   updatedAt: "2026-07-02T10:15:35Z"
  // }
});
```

## Usage Example

Angular's `SocketService` wraps the raw socket in RxJS Observables; the component subscribes and holds state as a signal. See [[COMPONENTS/03-Dashboard]] for the full `SocketService`/`JobsService` implementation.

```typescript
@Component({ selector: 'app-job-dashboard', standalone: true })
export class JobDashboardComponent implements OnInit, OnDestroy {
  jobs = signal<Job[]>([]);
  private subs = new Subscription();

  constructor(
    private socket: SocketService,
    private auth: AuthService
  ) {}

  ngOnInit() {
    this.socket.connect(this.auth.accessToken()!);
    this.socket.emit('subscribe', { channel: 'jobs' });

    this.subs.add(
      this.socket
        .on<Job>('job:created')
        .subscribe((job) => this.jobs.update((prev) => [job, ...prev]))
    );

    this.subs.add(
      this.socket
        .on<{ jobId: string; progress: number }>('job:progress')
        .subscribe((data) =>
          this.jobs.update((prev) =>
            prev.map((j) => (j.id === data.jobId ? { ...j, progress: data.progress } : j))
          )
        )
    );

    this.subs.add(
      this.socket
        .on<Job>('job:completed')
        .subscribe((job) =>
          this.jobs.update((prev) => prev.map((j) => (j.id === job.id ? job : j)))
        )
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
```

```html
<app-job-card *ngFor="let job of jobs()" [job]="job" />
```

## Related Documentation

- [[COMPONENTS/03-Dashboard]] - Uses WebSocket
- [[PATTERNS/09-Real-Time-Updates]] - Pattern explanation
- [[COMPONENTS/01-API-Service]] - Emits events
