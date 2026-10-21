/**
 * Discriminating vocabulary for each of the 60 syllabus sub-chapters.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two problems share one cause: the question bank records which *chapter* a
 * question belongs to but not which *sub-chapter*.
 *
 *  1. `questions.subchapter_id` is NULL for every row, so all 60 blueprint
 *     sampling rules silently degrade to chapter-level sampling.
 *  2. No question has an explanation, so a student who gets one wrong is told
 *     "Incorrect" and nothing else.
 *
 * A sub-chapter label fixes the first outright and gives the second something
 * true to say — "this tests 5.4 Transport Layer" is not an explanation, but it
 * points at a page in the syllabus, and it is derived rather than generated.
 *
 * WHY TERM LISTS AND NOT A MODEL
 * ------------------------------
 * No live API is used in this project, so classification has to be local and
 * deterministic. That is far more tractable than it sounds, because the chapter
 * is already known: the classifier never picks 1-of-60, only 1-of-6, and within
 * a chapter the six sub-chapters are deliberately disjoint topics. Separating
 * "Network Layer" from "Transport Layer" needs `subnet`/`ospf` against
 * `tcp`/`handshake`, not semantics.
 *
 * The cost is that this is a HEURISTIC over standard engineering vocabulary,
 * not a key. It is wrong sometimes. Everything downstream therefore treats a
 * match as a *hint* with a confidence, refuses to answer when two sub-chapters
 * tie, and degrades to the chapter — which is always exact. Nothing here is
 * ever presented to a student as an authoritative classification.
 *
 * TERM WEIGHTS
 * ------------
 * `strong` terms are ones that, within their chapter, essentially settle it:
 * `thevenin` appears in 1.2 Network Theorems and nowhere else in chapter 1.
 * `weak` terms lean without settling: `voltage` is chapter-1-wide.
 *
 * MATCHING, AND WHAT YOU THEREFORE NEED NOT WRITE
 * -----------------------------------------------
 * Terms are matched case-insensitively on word boundaries, so `ip` does not
 * match "multiple" and `or` does not match "for". Two normalisations are
 * applied by `services/subchapterClassifier.ts`, so do NOT spell these out:
 *
 *   - PLURALS. Every word may carry a trailing `s`/`es`, so `requirement`
 *     covers "requirements" and `pointer` covers "pointers".
 *   - SEPARATORS. Spaces and hyphens are interchangeable, so `open loop`
 *     covers "open-loop" and `non-functional requirement` covers "non
 *     functional requirements".
 *
 * Nothing is stemmed. Terms are only ever widened, never reduced to a root, so
 * `routing`, `router` and `route` stay distinct — chapter 5 depends on that.
 *
 * A term list is a maintained artefact, not a one-off: `scripts/classify-
 * subchapters.mjs` reports per-chapter coverage and the spread across the six
 * sub-chapters, and `--sample N` shows which terms drove each decision. A
 * sub-chapter that never wins is the signal that its terms are narrower than
 * the bank's phrasing.
 */

import type { SubchapterCode } from './syllabus';

export interface SubchapterTerms {
  /** Terms that, within the owning chapter, are near-decisive. */
  readonly strong: readonly string[];
  /** Terms that lean towards this sub-chapter without settling it. */
  readonly weak: readonly string[];
}

/**
 * Keyed by official sub-chapter code. Typed as a total record over
 * `SubchapterCode`, so omitting a sub-chapter is a compile error rather than a
 * silent coverage hole.
 */
export const SUBCHAPTER_TERMS: Record<SubchapterCode, SubchapterTerms> = {
  /* ── Chapter 1 — Basic Electrical and Electronics ───────────────────────── */
  AExE0101: {
    strong: ["ohm's law", 'ohms law', 'kirchhoff', 'kcl', 'kvl', 'coulomb', 'resistivity'],
    weak: ['resistance', 'resistor', 'current', 'voltage', 'series', 'parallel', 'charge', 'power', 'conductor', 'emf'],
  },
  AExE0102: {
    strong: ['thevenin', 'norton', 'superposition', 'maximum power transfer', 'reciprocity', 'millman', 'nodal analysis', 'mesh analysis'],
    weak: ['theorem', 'equivalent', 'network', 'node', 'mesh', 'loop', 'source transformation'],
  },
  AExE0103: {
    strong: ['alternating current', 'rms', 'root mean square', 'power factor', 'phasor', 'reactance', 'impedance', 'resonance', 'three-phase', 'three phase'],
    weak: ['frequency', 'sinusoidal', 'peak', 'inductor', 'capacitor', 'phase angle', 'hertz', 'waveform', 'ac'],
  },
  AExE0104: {
    strong: ['diode', 'zener', 'transistor', 'bjt', 'mosfet', 'fet', 'rectifier', 'pn junction', 'p-n junction', 'doping', 'thyristor', 'scr'],
    weak: ['semiconductor', 'silicon', 'germanium', 'forward bias', 'reverse bias', 'depletion', 'majority carrier', 'intrinsic', 'extrinsic'],
  },
  AExE0105: {
    strong: ['oscillator', 'multivibrator', 'wien bridge', 'colpitts', 'hartley', 'astable', 'monostable', 'bistable', 'signal generator', '555'],
    weak: ['barkhausen', 'waveform generator', 'sawtooth', 'square wave', 'triggering'],
  },
  AExE0106: {
    strong: ['amplifier', 'amplifiers', 'op-amp', 'op amp', 'operational amplifier', 'common emitter', 'common collector', 'common base', 'push-pull', 'class a', 'class b', 'slew rate', 'cmrr'],
    weak: ['gain', 'amplification', 'feedback', 'inverting', 'non-inverting', 'bandwidth', 'distortion', 'biasing'],
  },

  /* ── Chapter 2 — Digital Logic and Microprocessor ───────────────────────── */
  AExE0201: {
    strong: ['boolean', 'de morgan', "de morgan's", 'karnaugh', 'k-map', 'truth table', 'logic gate', 'nand', 'nor', 'xor', 'sop', 'pos', 'minterm', 'maxterm', "two's complement", "1's complement", "2's complement", 'gray code', 'bcd', 'excess-3', 'number system', 'radix', 'base of the', 'decimal equivalent', 'binary equivalent', 'octal equivalent', 'hexadecimal equivalent', 'logic family', 'ttl', 'cmos logic', 'ecl', 'fan-out', 'noise margin'],
    weak: ['binary', 'hexadecimal', 'octal', 'decimal', 'gate', 'inverter', 'complement', 'simplify', 'conversion', 'bit', 'digit'],
  },
  AExE0202: {
    strong: ['half adder', 'full adder', 'ripple carry', 'carry look', 'multiplexer', 'demultiplexer', 'mux', 'encoder', 'decoder', 'comparator', 'subtractor', 'alu'],
    weak: ['combinational', 'arithmetic circuit', 'carry', 'sum', 'borrow', 'select line', 'enable'],
  },
  AExE0203: {
    strong: ['flip-flop', 'flip flop', 'latch', 'sr flip', 'jk flip', 'd flip', 't flip', 'shift register', 'counter', 'ring counter', 'johnson counter', 'state diagram', 'state machine', 'moore', 'mealy', 'race around'],
    weak: ['sequential', 'clock', 'clocked', 'edge-triggered', 'preset', 'clear', 'excitation', 'synchronous', 'asynchronous'],
  },
  AExE0204: {
    strong: ['8085', '8086', 'accumulator', 'instruction set', 'addressing mode', 'opcode', 'instruction cycle', 'machine cycle', 'fetch', 'register pair', 'flag register', 'stack pointer', 'program counter'],
    weak: ['microprocessor', 'instruction', 'mnemonic', 'assembly', 'operand', 'arithmetic instruction'],
  },
  AExE0205: {
    strong: ['memory interfacing', 'address decoding', 'memory map', '8255', '8251', '8253', '8279', 'ppi', 'usart', 'bus cycle', 'wait state', 'minimum mode', 'maximum mode', 'tristate', 'latch enable', 'microprocessor system', 'i/o mapped', 'memory mapped i/o', 'io/m', 'ale signal', 'demultiplexing', 'clock generator', '8284', '8237', 'coprocessor', 'bus contention', 'read write cycle'],
    weak: ['interfacing', 'peripheral', 'address bus', 'data bus', 'control bus', 'chip select', 'system bus', 'external device', 'timing diagram'],
  },
  AExE0206: {
    strong: ['interrupt', 'interrupts', 'isr', 'interrupt service routine', 'maskable', 'non-maskable', 'nmi', 'rst 7.5', 'trap', 'vectored', 'interrupt vector', 'priority interrupt', '8259', 'dma', 'polling'],
    weak: ['service routine', 'priority', 'acknowledge', 'enable interrupt', 'disable interrupt', 'nested'],
  },

  /* ── Chapter 3 — Programming Language and Its Applications ──────────────── */
  ACtE0301: {
    strong: ['printf', 'scanf', 'main()', '#include', 'stdio', 'for loop', 'while loop', 'do-while', 'switch statement', 'goto', 'preprocessor', 'macro', 'typedef', 'storage class', 'auto', 'extern', 'recursion'],
    weak: ['c program', 'variable', 'datatype', 'data type', 'operator', 'loop', 'array', 'function', 'keyword', 'identifier', 'format specifier'],
  },
  ACtE0302: {
    strong: ['pointer', 'pointers', 'malloc', 'calloc', 'realloc', 'free()', 'dereference', 'struct', 'structure', 'union', 'fopen', 'fclose', 'fscanf', 'fprintf', 'fseek', 'file pointer', 'null pointer', 'pointer arithmetic', 'self-referential'],
    weak: ['address of', 'dynamic memory', 'allocation', 'member', 'nested structure', 'data file', 'text file', 'binary file', 'record'],
  },
  ACtE0303: {
    strong: ['cout', 'cin', 'iostream', 'constructor', 'destructor', 'this pointer', 'member function', 'access specifier', 'friend function', 'static member', 'inline function', 'copy constructor', 'namespace', 'reference variable'],
    weak: ['class', 'object', 'c++', 'private', 'public', 'protected', 'instance', 'declaration', 'scope resolution'],
  },
  ACtE0304: {
    strong: ['inheritance', 'polymorphism', 'encapsulation', 'abstraction', 'overloading', 'operator overloading', 'function overloading', 'base class', 'derived class', 'multiple inheritance', 'hybrid inheritance', 'diamond problem', 'message passing'],
    weak: ['oop', 'object-oriented', 'object oriented', 'reusability', 'data hiding', 'feature', 'paradigm'],
  },
  ACtE0305: {
    strong: ['virtual function', 'pure virtual', 'abstract class', 'vtable', 'dynamic binding', 'late binding', 'early binding', 'overriding', 'ofstream', 'ifstream', 'fstream', 'stream', 'file handling', 'seekg', 'seekp'],
    weak: ['virtual', 'runtime polymorphism', 'binding', 'file mode', 'open mode', 'stream class'],
  },
  ACtE0306: {
    strong: ['template', 'templates', 'generic programming', 'class template', 'function template', 'exception handling', 'try', 'catch', 'throw', 'stl', 'standard template library', 'iterator', 'vector<', 'container class'],
    weak: ['generic', 'exception', 'error handling', 'rethrow', 'type parameter', 'instantiation'],
  },

  /* ── Chapter 4 — Computer Organization and Embedded System ──────────────── */
  ACtE0401: {
    strong: ['control unit', 'microprogram', 'microinstruction', 'hardwired control', 'register transfer', 'rtl', 'cpu organization', 'datapath', 'instruction pipeline', 'pipelining', 'risc', 'cisc', 'general register organization', 'stack organization', 'instruction format', 'addressing mode', 'effective address', 'alu', 'control memory', 'instruction cycle', 'register set', 'accumulator'],
    weak: ['central processing', 'control signal', 'sequencer', 'processor', 'execution unit', 'cpu', 'instruction', 'operand', 'opcode'],
  },
  ACtE0402: {
    strong: ['booth', 'booth algorithm', 'floating point', 'ieee 754', 'cache memory', 'cache mapping', 'associative mapping', 'direct mapping', 'set associative', 'write through', 'write back', 'cache write policy', 'multilevel cache', 'cache hierarchy', 'virtual memory', 'tlb', 'memory hierarchy', 'hit ratio', 'miss rate', 'locality of reference', 'rom', 'ram', 'sram', 'dram', 'division algorithm', "2's complement representation", 'least recently used', 'lru'],
    weak: ['computer arithmetic', 'multiplication', 'division', 'overflow', 'normalization', 'mantissa', 'exponent', 'memory system', 'main memory', 'auxiliary memory'],
  },
  ACtE0403: {
    strong: ['input-output', 'i/o interface', 'i/o transfer', 'i/o transfer mode', 'programmed i/o', 'interrupt-initiated', 'dma', 'dma controller', 'direct memory access', 'memory-mapped i/o', 'isolated i/o', 'iop', 'daisy chain', 'serial communication', 'asynchronous transfer', 'strobe', 'handshaking', 'multiprocessor', 'crossbar', 'cache coherence', 'interprocessor', 'flynn'],
    weak: ['peripheral device', 'i/o', 'bus arbitration', 'priority encoder', 'shared memory', 'tightly coupled', 'loosely coupled'],
  },
  ACtE0404: {
    strong: ['embedded system', 'microcontroller', '8051', 'arduino', 'firmware', 'watchdog timer', 'adc', 'dac', 'sensor', 'actuator', 'i2c', 'spi', 'uart', 'cross compiler', 'in-circuit', 'bootloader', 'soc', 'system on chip', 'asip', 'application-specific instruction', 'single-purpose processor', 'general-purpose processor', 'custom processor', 'hardware software co-design', 'design metric'],
    weak: ['embedded', 'on-chip', 'peripheral port', 'timer', 'counter module', 'power consumption', 'target board'],
  },
  ACtE0405: {
    strong: ['real-time operating', 'rtos', 'hard real-time', 'soft real-time', 'task scheduling', 'rate monotonic', 'earliest deadline', 'priority inversion', 'context switch', 'semaphore', 'mutex', 'deadline', 'jitter', 'closed loop', 'open loop', 'pid controller', 'transfer function', 'process', 'thread', 'preemptive scheduling', 'scheduling algorithm', 'busy waiting', 'synchronization mechanism', 'device driver', 'kernel', 'spinlock', 'round robin'],
    weak: ['real-time', 'real time', 'scheduler', 'latency', 'preemptive', 'control system', 'feedback control', 'stability', 'operating system', 'task'],
  },
  ACtE0406: {
    strong: ['hdl', 'vhdl', 'verilog', 'fpga', 'cpld', 'asic', 'synthesis', 'testbench', 'behavioral modelling', 'structural modelling', 'dataflow modelling', 'netlist', 'place and route', 'ssi', 'msi', 'lsi', 'vlsi', 'photolithography', 'fabrication'],
    weak: ['hardware description', 'ic technology', 'integrated circuit', 'simulation', 'entity', 'module', 'wafer', 'gate array'],
  },

  /* ── Chapter 5 — Computer Network and Network Security ──────────────────── */
  ACtE0501: {
    strong: ['osi model', 'osi layer', 'tcp/ip model', 'physical layer', 'topology', 'bus topology', 'star topology', 'ring topology', 'mesh topology', 'coaxial', 'twisted pair', 'fiber optic', 'optical fiber', 'nyquist', 'shannon', 'modulation', 'multiplexing', 'tdm', 'fdm', 'wdm', 'baud', 'attenuation', 'manchester encoding', 'nrz'],
    weak: ['layer', 'transmission medium', 'bandwidth', 'lan', 'wan', 'man', 'bit rate', 'signal', 'guided media', 'unguided'],
  },
  ACtE0502: {
    strong: ['data link layer', 'mac address', 'framing', 'crc', 'cyclic redundancy', 'hamming', 'parity', 'error detection', 'error correction', 'stop-and-wait', 'sliding window', 'go-back-n', 'selective repeat', 'hdlc', 'csma', 'csma/cd', 'csma/ca', 'aloha', 'ethernet', 'switch', 'bridge', 'arq', 'piggyback'],
    weak: ['frame', 'flow control', 'checksum', 'collision', 'media access', 'retransmission', 'acknowledgement', 'hub'],
  },
  ACtE0503: {
    strong: ['network layer', 'ip address', 'ipv4', 'ipv6', 'subnet', 'subnet mask', 'subnetting', 'cidr', 'routing', 'router', 'routing table', 'rip', 'ospf', 'bgp', 'distance vector', 'link state', 'dijkstra', 'icmp', 'arp', 'nat', 'fragmentation', 'ttl', 'classful', 'classless', 'default gateway'],
    weak: ['packet', 'datagram', 'route', 'hop', 'forwarding', 'address class', 'broadcast address', 'host id', 'network id'],
  },
  ACtE0504: {
    strong: ['transport layer', 'tcp', 'udp', 'port number', 'three-way handshake', 'congestion control', 'slow start', 'sliding window protocol', 'socket', 'segment', 'sequence number', 'connection-oriented', 'connectionless', 'nagle', 'silly window'],
    weak: ['end-to-end', 'reliable delivery', 'multiplexing port', 'well-known port', 'ephemeral', 'handshake', 'teardown'],
  },
  ACtE0505: {
    strong: ['application layer', 'http', 'https', 'ftp', 'smtp', 'pop3', 'imap', 'dns', 'dhcp', 'telnet', 'ssh', 'snmp', 'url', 'uri', 'mime', 'web server', 'cookie', 'proxy server', 'cdn', 'rest'],
    weak: ['email', 'domain name', 'client-server', 'browser', 'hypertext', 'port 80', 'resolver', 'protocol port'],
  },
  ACtE0506: {
    strong: ['cryptography', 'encryption', 'decryption', 'symmetric key', 'asymmetric key', 'public key', 'private key', 'rsa', 'des', 'aes', 'diffie-hellman', 'digital signature', 'certificate authority', 'hash function', 'md5', 'sha', 'firewall', 'ids', 'intrusion detection', 'vpn', 'ssl', 'tls', 'kerberos', 'denial of service', 'malware', 'phishing'],
    weak: ['security', 'cipher', 'plaintext', 'ciphertext', 'key exchange', 'authentication', 'authorization', 'integrity', 'confidentiality', 'attack'],
  },

  /* ── Chapter 6 — Theory of Computation and Computer Graphics ────────────── */
  ACtE0601: {
    strong: ['finite automata', 'finite automaton', 'dfa', 'nfa', 'epsilon-nfa', 'regular expression', 'regular language', 'pumping lemma for regular', 'myhill-nerode', 'state minimization', 'moore machine', 'mealy machine', 'kleene'],
    weak: ['automata', 'automaton', 'transition function', 'accepting state', 'final state', 'start state', 'alphabet', 'string acceptance', 'regular'],
  },
  ACtE0602: {
    strong: ['context-free grammar', 'context free grammar', 'cfg', 'context-free language', 'pushdown automata', 'pda', 'parse tree', 'derivation tree', 'ambiguous grammar', 'chomsky normal form', 'greibach', 'left recursion', 'useless symbol', 'leftmost derivation'],
    weak: ['grammar', 'production rule', 'terminal', 'non-terminal', 'derivation', 'parsing', 'context-free', 'stack automaton'],
  },
  ACtE0603: {
    strong: ['turing machine', 'turing', 'halting problem', 'decidable', 'undecidable', 'recursively enumerable', 'church-turing', 'post correspondence', 'np-complete', 'np-hard', 'reducibility', 'universal turing', 'linear bounded automata', 'rice theorem'],
    weak: ['tape', 'tape head', 'computability', 'recursive language', 'complexity class', 'polynomial time', 'intractable'],
  },
  ACtE0604: {
    strong: ['raster scan', 'random scan', 'frame buffer', 'crt', 'pixel', 'resolution', 'aspect ratio', 'dda algorithm', 'bresenham', 'line drawing', 'midpoint circle', 'scan line fill', 'boundary fill', 'flood fill', 'anti-aliasing', 'cohen-sutherland', 'clipping', 'viewport'],
    weak: ['graphics', 'display device', 'rasterization', 'refresh rate', 'interlacing', 'colour model', 'rgb', 'cmy', 'window'],
  },
  ACtE0605: {
    strong: ['2d transformation', '2d transformations', 'two-dimensional transformation', 'homogeneous coordinate', 'composite transformation', 'shearing', 'reflection about', 'rotation matrix', 'scaling factor', 'translation vector'],
    weak: ['transformation', 'translation', 'rotation', 'scaling', 'shear', 'reflection', 'matrix', '2d', 'coordinate'],
  },
  ACtE0606: {
    strong: ['3d transformation', '3d transformations', 'three-dimensional transformation', 'projection', 'parallel projection', 'perspective projection', 'orthographic', 'vanishing point', 'hidden surface', 'z-buffer', 'depth buffer', 'back-face', 'painter algorithm', 'bezier', 'b-spline', 'phong', 'gouraud', 'ray tracing'],
    weak: ['3d', 'three-dimensional', 'viewing pipeline', 'surface', 'solid modelling', 'shading', 'illumination', 'camera'],
  },

  /* ── Chapter 7 — Data Structures, Database and Operating System ─────────── */
  ACtE0701: {
    strong: ['linked list', 'singly linked', 'doubly linked', 'circular linked', 'stack push', 'stack pop', 'queue enqueue', 'dequeue', 'circular queue', 'priority queue', 'binary tree', 'binary search tree', 'bst', 'avl tree', 'b-tree', 'b+ tree', 'heap', 'tree traversal', 'preorder', 'inorder', 'postorder', 'infix', 'postfix', 'prefix notation'],
    weak: ['data structure', 'list', 'tree', 'node pointer', 'stack', 'queue', 'abstract data type', 'adt', 'traversal', 'leaf', 'height of tree', 'balanced'],
  },
  ACtE0702: {
    strong: ['bubble sort', 'selection sort', 'insertion sort', 'merge sort', 'quick sort', 'quicksort', 'heap sort', 'radix sort', 'shell sort', 'counting sort', 'linear search', 'binary search', 'hashing', 'hash table', 'collision resolution', 'bfs', 'dfs', 'breadth-first', 'depth-first', 'kruskal', 'prim', 'bellman-ford', 'floyd-warshall', 'minimum spanning tree', 'topological sort', 'dynamic programming', 'greedy algorithm', 'divide and conquer'],
    weak: ['sorting', 'searching', 'graph', 'adjacency matrix', 'adjacency list', 'shortest path', 'complexity', 'big-o', 'stable sort', 'in-place', 'pivot'],
  },
  ACtE0703: {
    strong: ['er model', 'entity-relationship', 'relational model', 'normalization', '1nf', '2nf', '3nf', 'bcnf', 'functional dependency', 'candidate key', 'primary key', 'foreign key', 'super key', 'sql', 'select statement', 'join', 'inner join', 'outer join', 'group by', 'relational algebra', 'relational calculus', 'denormalization', 'dbms architecture', 'schema', 'tuple'],
    weak: ['database', 'data model', 'relation', 'attribute', 'cardinality', 'query', 'table', 'view', 'constraint', 'dependency'],
  },
  ACtE0704: {
    strong: ['transaction', 'acid', 'atomicity', 'durability', 'serializability', 'concurrency control', 'two-phase locking', '2pl', 'lock', 'shared lock', 'exclusive lock', 'deadlock detection', 'timestamp ordering', 'checkpoint', 'rollback', 'commit', 'write-ahead log', 'recovery', 'dirty read', 'phantom read', 'isolation level', 'cascading abort'],
    weak: ['schedule', 'conflict', 'log record', 'undo', 'redo', 'concurrent execution', 'granularity', 'wait-for graph'],
  },
  ACtE0705: {
    strong: ['process state', 'process control block', 'pcb', 'cpu scheduling', 'fcfs', 'sjf', 'shortest job', 'round robin', 'priority scheduling', 'turnaround time', 'waiting time', 'context switching', 'thread', 'multithreading', 'critical section', 'producer-consumer', "dekker", 'peterson', 'banker algorithm', 'system call', 'kernel mode', 'user mode', 'monolithic kernel', 'microkernel', 'ipc'],
    weak: ['operating system', 'process', 'scheduling', 'deadlock', 'starvation', 'synchronization', 'cpu burst', 'ready queue', 'preemption', 'os'],
  },
  ACtE0706: {
    strong: ['paging', 'page table', 'page fault', 'segmentation', 'demand paging', 'page replacement', 'fifo replacement', 'lru', 'optimal replacement', 'thrashing', 'working set', 'belady', 'swapping', 'fragmentation', 'best fit', 'worst fit', 'first fit', 'inode', 'fat', 'file allocation', 'directory structure', 'disk scheduling', 'seek time', 'fcfs disk', 'sstf', 'elevator algorithm', 'raid'],
    weak: ['memory management', 'file system', 'allocation strategy', 'virtual address', 'physical address', 'frame', 'disk', 'administration', 'backup', 'mounting'],
  },

  /* ── Chapter 8 — Software Engineering and OOAD ──────────────────────────── */
  ACtE0801: {
    strong: ['waterfall model', 'spiral model', 'incremental model', 'prototype model', 'rad model', 'v-model', 'big bang model', 'agile', 'scrum', 'extreme programming', 'software process model', 'requirement elicitation', 'requirement analysis', 'requirement management', 'requirement engineering', 'requirement document', 'interface specification', 'srs', 'functional requirement', 'non-functional requirement', 'feasibility study', 'requirement validation', 'cmm', 'process maturity'],
    weak: ['software process', 'requirement', 'sdlc', 'life cycle', 'stakeholder', 'specification', 'phase', 'iteration', 'customer'],
  },
  ACtE0802: {
    strong: ['cohesion', 'coupling', 'modularity', 'modular decomposition', 'architectural design', 'data flow diagram', 'dfd', 'structure chart', 'decision table', 'design pattern', 'top-down design', 'bottom-up design', 'information hiding', 'interface design', 'software architecture', 'layered architecture', 'reference architecture', 'design heuristic', 'real-time software design', 'case tool', 'computer-aided software engineering', 'software design'],
    weak: ['module', 'abstraction level', 'component', 'refinement', 'design document', 'pseudocode', 'flowchart', 'design'],
  },
  ACtE0803: {
    strong: ['unit testing', 'integration testing', 'system testing', 'acceptance testing', 'black box testing', 'white box testing', 'regression testing', 'alpha testing', 'beta testing', 'test case', 'cyclomatic complexity', 'basis path', 'boundary value', 'equivalence partition', 'cocomo', 'function point', 'loc estimation', 'effort estimation', 'software quality', 'iso 9001', 'six sigma', 'mccall', 'software reliability', 'defect density', 'test automation', 'formal technical review', 'cmmi', 'test plan', 'test driver', 'test stub', 'mutation testing'],
    weak: ['testing', 'test', 'debugging', 'verification', 'validation', 'cost estimation', 'quality management', 'quality assurance', 'metric', 'walkthrough', 'inspection', 'review'],
  },
  ACtE0804: {
    strong: ['use case diagram', 'use case', 'actor', 'object-oriented analysis', 'ooa', 'object-oriented development', 'object-oriented modeling', 'object-oriented modelling', 'domain model', 'conceptual model', 'crc card', 'object identification', 'association multiplicity', 'association', 'aggregation', 'composition relationship', 'generalization', 'class diagram'],
    weak: ['object-oriented fundamental', 'analysis model', 'object model', 'identity', 'classification', 'relationship', 'scenario', 'uml', 'object-oriented'],
  },
  ACtE0805: {
    strong: ['sequence diagram', 'collaboration diagram', 'interaction diagram', 'state chart diagram', 'statechart', 'activity diagram', 'component diagram', 'deployment diagram', 'object-oriented design', 'ood', 'design class', 'responsibility assignment', 'grasp', 'solid principle', 'open-closed principle', 'liskov', 'system behavior', 'system behaviour', 'transition from analysis to design'],
    weak: ['design model', 'dynamic model', 'static model', 'message sequence', 'lifeline', 'operation signature', 'visibility'],
  },
  ACtE0806: {
    strong: ['implementation strategy', 'code generation from design', 'forward engineering', 'reverse engineering', 'reengineering', 'refactoring', 'object persistence', 'object-oriented database', 'mapping class to table', 'mapping design to code', 'class definition', 'design to code', 'software reuse', 'component reuse', 'maintenance type', 'corrective maintenance', 'adaptive maintenance', 'legacy system', 'configuration management', 'version control', 'exception handling'],
    weak: ['implementation', 'coding standard', 'maintenance', 'deployment', 'migration', 'documentation', 'build'],
  },

  /* ── Chapter 9 — Artificial Intelligence and Neural Networks ────────────── */
  ACtE0901: {
    strong: ['turing test', 'intelligent agent', 'rational agent', 'agent architecture', 'simple reflex agent', 'model-based agent', 'goal-based agent', 'utility-based agent', 'learning agent', 'pe-as', 'peas', 'agent environment', 'history of ai', 'strong ai', 'weak ai'],
    weak: ['artificial intelligence', 'ai', 'agent', 'percept', 'sensor input', 'environment type', 'intelligence', 'application of ai'],
  },
  ACtE0902: {
    strong: ['breadth-first search', 'depth-first search', 'uniform cost search', 'iterative deepening', 'bidirectional search', 'best-first search', 'greedy best-first', 'a* search', 'a-star', 'heuristic function', 'admissible heuristic', 'hill climbing', 'simulated annealing', 'genetic algorithm', 'minimax', 'alpha-beta pruning', 'constraint satisfaction', 'state space search', 'means-ends'],
    weak: ['search technique', 'problem solving', 'search tree', 'goal state', 'initial state', 'path cost', 'optimality', 'completeness', 'branching factor', 'game playing'],
  },
  ACtE0903: {
    strong: ['propositional logic', 'predicate logic', 'first-order logic', 'fol', 'resolution refutation', 'unification', 'forward chaining', 'backward chaining', 'horn clause', 'semantic network', 'conceptual graph', 'frame representation', 'script representation', 'ontology', 'inference rule', 'modus ponens', 'cnf conversion', 'skolemization', 'non-monotonic reasoning', 'bayesian network', 'certainty factor', 'fuzzy logic'],
    weak: ['knowledge representation', 'knowledge base', 'inference', 'reasoning', 'logic', 'quantifier', 'predicate', 'clause', 'uncertainty'],
  },
  ACtE0904: {
    strong: ['expert system', 'knowledge acquisition', 'inference engine', 'mycin', 'dendral', 'shell of expert', 'explanation facility', 'natural language processing', 'nlp', 'morphological analysis', 'syntactic analysis', 'semantic analysis', 'pragmatic analysis', 'parsing sentence', 'speech recognition', 'machine translation', 'tokenization', 'part of speech'],
    weak: ['expert', 'domain expert', 'rule base', 'natural language', 'language understanding', 'ambiguity', 'discourse', 'corpus'],
  },
  ACtE0905: {
    strong: ['supervised learning', 'unsupervised learning', 'reinforcement learning', 'decision tree learning', 'id3', 'information gain', 'entropy', 'naive bayes', 'k-nearest', 'knn', 'k-means', 'clustering', 'support vector', 'svm', 'overfitting', 'underfitting', 'cross-validation', 'training set', 'test set', 'confusion matrix', 'regression model', 'q-learning'],
    weak: ['machine learning', 'learning algorithm', 'classification', 'prediction', 'feature', 'label', 'dataset', 'accuracy', 'generalization'],
  },
  ACtE0906: {
    strong: ['neural network', 'neural networks', 'perceptron', 'multilayer perceptron', 'backpropagation', 'back propagation', 'activation function', 'sigmoid function', 'relu', 'tanh function', 'hidden layer', 'feedforward network', 'recurrent neural', 'rnn', 'cnn', 'convolutional', 'hopfield', 'boltzmann', 'kohonen', 'self-organizing map', 'hebbian', 'gradient descent', 'deep learning'],
    weak: ['neuron', 'artificial neuron', 'synaptic weight', 'bias term', 'layer', 'threshold function', 'epoch', 'learning rate', 'network topology'],
  },

  /* ── Chapter 10 — Project Planning, Design and Implementation ───────────── */
  AALL1001: {
    strong: ['engineering drawing', 'orthographic projection', 'isometric', 'first angle', 'third angle', 'sectional view', 'dimensioning', 'drawing scale', 'drawing sheet', 'sheet size', 'cad', 'autocad', 'line type', 'title block', 'blueprint reading', 'plan and elevation', 'site plan', 'lettering', 'drawing standard'],
    weak: ['drawing', 'projection view', 'sketch', 'symbol', 'drafting', 'layout drawing', 'scale', 'view'],
  },
  AALL1002: {
    strong: ['engineering economics', 'time value of money', 'present worth', 'future worth', 'annuity', 'compound interest', 'simple interest', 'rate of return', 'irr', 'npv', 'net present value', 'benefit-cost ratio', 'payback period', 'depreciation', 'straight line depreciation', 'break-even', 'cash flow', 'cash flow diagram', 'inflation', 'replacement analysis', 'comparison of alternatives', 'corporate tax', 'tax rate', 'minimum attractive rate', 'sunk cost', 'opportunity cost'],
    weak: ['economics', 'interest rate', 'cost analysis', 'discount rate', 'salvage value', 'capital', 'investment', 'economic life'],
  },
  AALL1003: {
    strong: ['cpm', 'critical path', 'critical path method', 'pert', 'gantt chart', 'network diagram', 'float', 'slack time', 'forward pass', 'backward pass', 'earliest start', 'latest finish', 'crashing', 'wbs', 'work breakdown structure', 'milestone', 'resource levelling', 'resource leveling', 'resource smoothing', 'resource allocation', 'bar chart schedule', 'project planning', 'project baseline', 'project schedule'],
    weak: ['scheduling', 'activity duration', 'dependency', 'sequence of activity', 'timeline', 'critical activity', 'planning'],
  },
  AALL1004: {
    strong: ['project management', 'project manager', 'project life cycle', 'project phase', 'project organization', 'matrix organization', 'stakeholder management', 'risk management', 'risk analysis', 'risk register', 'procurement', 'contract type', 'contract management', 'fixed-price contract', 'request for proposal', 'rfp', 'tender', 'bidding', 'quality control in project', 'project monitoring', 'monitoring and evaluation', 'project control', 'project execution', 'project classification', 'project financing', 'project information system', 'change management', 'earned value', 'project closure', 'pmbok', 'characteristic of a project'],
    weak: ['management function', 'leadership', 'team', 'organization structure', 'planning function', 'controlling', 'project scope', 'budget', 'project'],
  },
  AALL1005: {
    strong: ['professional practice', 'code of ethics', 'engineering ethics', 'professional ethics', 'professional liability', 'professional negligence', 'conflict of interest', 'whistleblowing', 'intellectual property', 'patent', 'copyright', 'trademark', 'professional conduct', 'duty of care', 'safety responsibility', 'consulting engineer', 'occupational health', 'health and safety', 'environmental consideration', 'environmental impact', 'sustainable engineering', 'sustainability', 'public safety'],
    weak: ['ethics', 'ethical', 'profession', 'professionalism', 'responsibility', 'obligation', 'public welfare', 'moral'],
  },
  AALL1006: {
    strong: ['nepal engineering council', 'nec act', 'nec regulation', 'nec registration', 'engineering council act', 'licensing requirement', 'registration of engineer', 'professional licence', 'professional license', 'regulatory body', 'disciplinary action', 'nepal engineers association', 'scope of work regulation', 'renewal of licence', 'statutory body', 'engineering council'],
    weak: ['council', 'regulation', 'act', 'licence', 'license', 'registration', 'authority', 'bylaw', 'legal provision'],
  },
};
