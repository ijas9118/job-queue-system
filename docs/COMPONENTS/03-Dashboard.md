# Dashboard (`apps/dashboard`)

## Overview

The **Dashboard** is the Angular frontend for monitoring and controlling jobs. It connects to the API via REST and receives real-time updates via WebSocket.

**Location**: `apps/dashboard`  
**Framework**: Angular (current stable, standalone components)  
**Styling**: Tailwind CSS  
**Build Tool**: Angular CLI (esbuild)  
**Real-time**: Socket.IO client

## Responsibilities

### ✅ Dashboard Shows

- **Job List**: User's submitted jobs with filtering
- **Job Details**: Full execution history and logs
- **Job Form**: Submit new jobs with validation
- **Worker Status**: Active workers and health
- **Queue Metrics**: Queue depth, success rates
- **Real-time Updates**: Live job status without polling
- **Admin Panel**: Load testing, DLQ management (admin only)

### ❌ Dashboard Does NOT

- Store application state (fetches from server)
- Make direct database queries
- Process jobs (API and workers do that)
- Keep state during reload (refreshes from server)

## Page Structure

### Dashboard Home (`/`)

```
┌─────────────────────────────────────────────┐
│  Job Queue System Dashboard                 │
├─────────────────────────────────────────────┤
│ [Submit Job] [Filters] [Search]             │
├─────────────────────────────────────────────┤
│ Queue Stats:                                │
│  Queued: 5  │  Active: 2  │  Failed: 1     │
├─────────────────────────────────────────────┤
│ Your Jobs (Sorted by newest first)          │
│                                             │
│ [Job 1] Status: COMPLETED ✅                │
│  Type: send-email  Duration: 2s             │
│  Submitted: 2 mins ago                      │
│                                             │
│ [Job 2] Status: ACTIVE 🔄                   │
│  Type: process-video  Duration: 15s         │
│  Submitted: 1 min ago                       │
│                                             │
│ [Job 3] Status: QUEUED ⏳                    │
│  Type: generate-report  Priority: 1         │
│  Submitted: 30s ago                         │
│                                             │
└─────────────────────────────────────────────┘
```

### Job Detail Page (`/jobs/:jobId`)

```
┌─────────────────────────────────────────────┐
│ Job: Welcome Email to john@example.com      │
├─────────────────────────────────────────────┤
│ Status: COMPLETED ✅                         │
│ Type: send-email                            │
│ Created: 2026-07-02 10:00:00               │
│ Completed: 2026-07-02 10:00:02             │
│ Duration: 2,245ms                          │
│                                             │
│ Payload:                                    │
│ ├─ to: john@example.com                    │
│ ├─ subject: Welcome!                       │
│ └─ template: welcome                       │
│                                             │
│ Result:                                     │
│ └─ messageId: msg-123456                   │
│                                             │
├─ Execution History                          │
│ ├─ Attempt 1: SUCCESS (2.2s)               │
│ │  └─ result: { messageId: msg-123456 }   │
│                                             │
├─ Logs                                       │
│ ├─ [INFO] Starting email send              │
│ ├─ [INFO] Connected to SMTP                │
│ ├─ [INFO] Sending to john@example.com      │
│ ├─ [INFO] Email sent successfully          │
│ └─ [INFO] Email job completed              │
│                                             │
│ [Retry] [Cancel] [Delete]                  │
└─────────────────────────────────────────────┘
```

### Workers Page (`/workers`)

```
┌─────────────────────────────────────────────┐
│ Workers (3 Active)                          │
├─────────────────────────────────────────────┤
│ Worker 1                                    │
│ Status: BUSY 🟢                              │
│ Current Job: send-email (job-123)           │
│ Duration: 1.5s elapsed                      │
│ Jobs Processed: 1,523                       │
│ Success Rate: 98.5%                         │
│ Avg Processing Time: 2.3s                   │
│ Last Heartbeat: 2s ago                      │
│                                             │
│ Worker 2                                    │
│ Status: IDLE ⚪                              │
│ Current Job: (none)                         │
│ Jobs Processed: 942                         │
│ Success Rate: 99.2%                         │
│ Avg Processing Time: 1.8s                   │
│ Last Heartbeat: just now                    │
│                                             │
│ Worker 3                                    │
│ Status: OFFLINE ❌                           │
│ Last Heartbeat: 5m ago                      │
│                                             │
└─────────────────────────────────────────────┘
```

### Dead Letter Queue (`/dlq`) - Admin Only

```
┌─────────────────────────────────────────────┐
│ Dead Letter Queue (5 Jobs)                  │
├─────────────────────────────────────────────┤
│ [Inspect] [Replay] [Delete]                 │
│                                             │
│ send-email: invalid@example.com             │
│ Error: Invalid email address                │
│ Retries: 3/3                                │
│ Moved: 1h ago                               │
│                                             │
│ process-video: file-missing.mp4             │
│ Error: File not found                       │
│ Retries: 3/3                                │
│ Moved: 30m ago                              │
│                                             │
└─────────────────────────────────────────────┘
```

### Admin Panel (`/admin`) - Admin Only

```
┌─────────────────────────────────────────────┐
│ Admin Panel                                 │
├─────────────────────────────────────────────┤
│ Load Testing:                               │
│ Job Type: [send-email  ▼]                   │
│ Job Count: [100]                            │
│ Concurrency: [10]                           │
│ [Start Load Test]                           │
│                                             │
│ Results:                                    │
│ Total Submitted: 100                        │
│ Success Rate: 95%                           │
│ Avg Duration: 2.3s                          │
│                                             │
└─────────────────────────────────────────────┘
```

## Components Structure

```
apps/dashboard/
├── src/
│   ├── app/
│   │   ├── pages/
│   │   │   ├── dashboard/
│   │   │   │   ├── dashboard.component.ts    # Job list & overview
│   │   │   │   ├── dashboard.component.html
│   │   │   │   └── dashboard.component.scss
│   │   │   ├── job-detail/
│   │   │   │   └── job-detail.component.ts   # Single job with history
│   │   │   ├── workers/
│   │   │   │   └── workers.component.ts      # Worker monitoring
│   │   │   ├── dlq/
│   │   │   │   └── dlq.component.ts          # Dead letter queue (admin)
│   │   │   └── admin/
│   │   │       └── admin.component.ts        # Admin controls (admin)
│   │   ├── components/
│   │   │   ├── job-form/                     # Submit job form
│   │   │   ├── job-status-badge/             # Status with icon
│   │   │   ├── progress-bar/                 # Job progress bar
│   │   │   ├── worker-card/                  # Worker info card
│   │   │   ├── queue-stats/                  # Queue metrics
│   │   │   ├── log-viewer/                   # Execution logs
│   │   │   ├── navbar/                       # Top navigation
│   │   │   └── sidebar/                      # Left sidebar
│   │   ├── services/
│   │   │   ├── jobs.service.ts               # Fetch & update jobs (RxJS)
│   │   │   ├── socket.service.ts             # WebSocket connection
│   │   │   ├── auth.service.ts               # Auth state
│   │   │   ├── metrics.service.ts            # Queue stats
│   │   │   └── api.service.ts                # HttpClient wrapper
│   │   ├── interceptors/
│   │   │   ├── auth.interceptor.ts           # Attach JWT to requests
│   │   │   └── error.interceptor.ts          # Global HTTP error handling
│   │   ├── guards/
│   │   │   ├── auth.guard.ts                 # Route protection
│   │   │   └── admin.guard.ts                # Admin-only routes
│   │   ├── models/
│   │   │   └── types.ts                      # TypeScript interfaces
│   │   ├── app.component.ts                  # Root component
│   │   ├── app.routes.ts                     # Route definitions (lazy-loaded)
│   │   └── app.config.ts                     # App-wide providers
│   ├── styles.scss                           # Tailwind imports
│   └── index.html
│
├── public/
├── tailwind.config.js
├── angular.json
└── package.json
```

## Key Services

Angular uses **injectable services** with RxJS Observables in place of React hooks.

### JobsService

```typescript
@Injectable({ providedIn: 'root' })
export class JobsService {
  private jobsSubject = new BehaviorSubject<Job[]>([]);
  jobs$ = this.jobsSubject.asObservable();

  constructor(
    private api: ApiService,
    private socket: SocketService
  ) {
    this.socket.on('job:completed').subscribe(() => this.refetch());
  }

  refetch(filters: JobFilters = {}) {
    this.api
      .get<Job[]>('/jobs', { params: filters })
      .subscribe((jobs) => this.jobsSubject.next(jobs));
  }
}
```

```typescript
// In a component
export class DashboardComponent {
  jobs = toSignal(this.jobsService.jobs$, { initialValue: [] });

  constructor(private jobsService: JobsService) {}
}
```

### SocketService

```typescript
@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket;

  connect(token: string) {
    this.socket = io(environment.wsUrl, { auth: { token } });
  }

  on<T>(event: string): Observable<T> {
    return new Observable((subscriber) => {
      this.socket.on(event, (data: T) => subscriber.next(data));
      return () => this.socket.off(event);
    });
  }
}
```

### AuthService

The access token is kept **in memory only** (a signal) — never in `localStorage`. The refresh token lives in an HttpOnly cookie the browser manages automatically; Angular code never touches it directly. See [[API/01-Authentication]] for the full server-side flow.

```typescript
@Injectable({ providedIn: 'root' })
export class AuthService {
  private accessTokenSignal = signal<string | null>(null); // in-memory only
  private userSignal = signal<User | null>(null);

  user = this.userSignal.asReadonly();
  isAdmin = computed(() => this.userSignal()?.role === 'admin');

  login(email: string, password: string) {
    // Server sets the refresh token as an HttpOnly cookie on this response;
    // withCredentials so the cookie round-trips.
    return this.http
      .post<LoginResponse>('/auth/login', { email, password }, { withCredentials: true })
      .pipe(
        tap((res) => {
          this.accessTokenSignal.set(res.accessToken);
          this.userSignal.set(res.user);
        })
      );
  }

  silentRefresh() {
    // Cookie is sent automatically; no body needed.
    return this.http
      .post<{ accessToken: string }>('/auth/refresh', {}, { withCredentials: true })
      .pipe(tap((res) => this.accessTokenSignal.set(res.accessToken)));
  }

  accessToken() {
    return this.accessTokenSignal();
  }

  logout() {
    this.http.post('/auth/logout', {}, { withCredentials: true }).subscribe();
    this.accessTokenSignal.set(null);
    this.userSignal.set(null);
  }
}
```

On app bootstrap (e.g. an `APP_INITIALIZER`), call `silentRefresh()` once to exchange the HttpOnly cookie for a fresh in-memory access token — this restores the session after a page reload without ever putting a token in storage JS can read.

```html
<!-- Template usage -->
<app-admin-panel *ngIf="authService.isAdmin()" />
```

## Real-Time Updates

Dashboard subscribes to WebSocket events via `SocketService` and updates signals/observables without polling:

```typescript
// Subscribe to job updates
this.socket.emit('subscribe', {
  channel: 'jobs',
  filters: { userId: this.authService.user()?.id },
});

// Listen for events
this.socket.on<Job>('job:created').subscribe((job) => {
  this.jobsSubject.next([job, ...this.jobsSubject.value]);
});

this.socket.on<{ jobId: string; progress: number }>('job:progress').subscribe((data) => {
  const updated = this.jobsSubject.value.map((j) =>
    j.id === data.jobId ? { ...j, progress: data.progress } : j
  );
  this.jobsSubject.next(updated);
});

this.socket.on<Job>('job:completed').subscribe((job) => {
  const updated = this.jobsSubject.value.map((j) => (j.id === job.id ? job : j));
  this.jobsSubject.next(updated);
});
```

## Authentication Flow

```typescript
// Login component
handleLogin(email: string, password: string) {
  this.authService.login(email, password).subscribe(() => {
    this.router.navigate(['/']);
  });
}

// Route protection (functional guard)
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.user() ? true : router.parseUrl('/login');
};

// app.routes.ts
export const routes: Routes = [
  { path: '', component: DashboardComponent, canActivate: [authGuard] }
];

// Auth interceptor attaches the in-memory access token to every request.
// The refresh token cookie is attached by the browser automatically (withCredentials).
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.accessToken();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

// On a 401 with TOKEN_EXPIRED, the error interceptor calls silentRefresh()
// once and retries the original request before giving up and logging out.
```

## Styling with Tailwind

```typescript
// job-status-badge.component.ts
@Component({
  selector: 'app-job-status-badge',
  standalone: true,
  template: ` <span [class]="badgeClasses">{{ status.toUpperCase() }}</span> `,
})
export class JobStatusBadgeComponent {
  @Input() status!: JobStatus;

  private colors: Record<JobStatus, string> = {
    queued: 'bg-blue-100 text-blue-800',
    active: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    dead_letter: 'bg-red-200 text-red-900',
  };

  get badgeClasses() {
    return `px-3 py-1 rounded-full text-sm font-medium ${this.colors[this.status]}`;
  }
}
```

## State Management

Using **RxJS + Angular Signals** for server state — no extra state library required:

```typescript
// Fetch jobs (service)
readonly jobs = toSignal(
  this.api.get<Job[]>('/jobs', { params: { status: this.status(), offset: this.offset() } }),
  { initialValue: [] }
);

// Submit job
submitJob(jobData: JobPayload) {
  return this.api.post<Job>('/jobs', jobData).pipe(
    tap(() => this.refetch())
  );
}
```

For larger apps needing centralized/global state, **NgRx** (or `@ngrx/signals`) is the idiomatic escalation path — not needed at this project's scale.

## Form Validation

Using **Angular Reactive Forms** with Zod for schema-level validation:

```typescript
import { z } from 'zod';

const jobSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  priority: z.number().optional(),
});

@Component({ selector: 'app-job-form', standalone: true })
export class JobFormComponent {
  form = this.fb.group({
    type: ['', Validators.required],
    payload: [{}],
    priority: [null as number | null],
  });

  constructor(private fb: FormBuilder) {}

  onSubmit() {
    const result = jobSchema.safeParse(this.form.value);
    if (!result.success) {
      // surface result.error.issues to the template
      return;
    }
    this.submitJob(result.data);
  }
}
```

```html
<form [formGroup]="form" (ngSubmit)="onSubmit()">
  <input formControlName="type" />
  <span *ngIf="form.get('type')?.invalid && form.get('type')?.touched"> Type is required </span>
</form>
```

## Error Handling

```typescript
// Global HTTP error interceptor
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && error.error?.error?.code === 'TOKEN_EXPIRED') {
        // Access token expired — try one silent refresh via the cookie, then retry.
        return auth.silentRefresh().pipe(
          switchMap(() => next(req)),
          catchError(() => {
            auth.logout();
            router.navigate(['/login']);
            return throwError(() => error);
          })
        );
      }
      if (error.status === 401) {
        auth.logout();
        router.navigate(['/login']);
      }
      if (error.status === 403) {
        // show toast: 'You do not have permission for this action'
      }
      return throwError(() => error);
    })
  );
};
```

## Performance Optimization

```typescript
// Lazy-loaded routes (app.routes.ts)
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'jobs/:id',
    loadComponent: () =>
      import('./pages/job-detail/job-detail.component').then((m) => m.JobDetailComponent),
  },
  {
    path: 'workers',
    loadComponent: () =>
      import('./pages/workers/workers.component').then((m) => m.WorkersComponent),
  },
];

// OnPush change detection (equivalent to React.memo)
@Component({
  selector: 'app-job-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class JobCardComponent {
  @Input() job!: Job;
}

// Virtual scrolling for large lists (Angular CDK)
import { ScrollingModule } from '@angular/cdk/scrolling';
```

```html
<cdk-virtual-scroll-viewport itemSize="80" class="h-screen">
  <app-job-card *cdkVirtualFor="let job of jobs()" [job]="job" />
</cdk-virtual-scroll-viewport>
```

## Testing

```typescript
// Component test (TestBed)
describe('JobFormComponent', () => {
  let fixture: ComponentFixture<JobFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobFormComponent, ReactiveFormsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(JobFormComponent);
  });

  it('submits job with validation', () => {
    const component = fixture.componentInstance;
    component.form.setValue({ type: 'send-email', payload: {}, priority: null });

    const submitSpy = jest.spyOn(component, 'onSubmit');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    expect(submitSpy).toHaveBeenCalled();
  });
});
```

## Build & Deployment

```bash
# Development
pnpm dev

# Production build
pnpm build

# Output in dist/
```

## Related Documentation

- [[02-ARCHITECTURE-OVERVIEW]] - How dashboard fits in system
- [[COMPONENTS/01-API-Service]] - API it calls
- [[WEBSOCKET]] - Real-time updates
- [[DEPLOYMENT]] - How to run dashboard
