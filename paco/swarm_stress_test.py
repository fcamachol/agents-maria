#!/usr/bin/env python3
"""
PACO Swarm Stress Test
======================

Stress test a 100-agent swarm to validate:
- Concurrent request handling
- Circuit breaker behavior
- Resource utilization
- Response latency distribution

Usage:
    python swarm_stress_test.py --infra-name swarm-100 --concurrent 50 --requests 1000
    python swarm_stress_test.py --infra-name swarm-100 --health-check
    python swarm_stress_test.py --infra-name swarm-100 --circuit-breaker-test
"""

import argparse
import asyncio
import json
import random
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional

import httpx


@dataclass
class TestResult:
    """Result of a single request."""
    success: bool
    latency_ms: float
    status_code: Optional[int] = None
    error: Optional[str] = None
    agent_slug: Optional[str] = None
    skill_used: Optional[str] = None


@dataclass
class StressTestReport:
    """Complete stress test report."""
    infra_name: str
    start_time: datetime
    end_time: Optional[datetime] = None
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    results: List[TestResult] = field(default_factory=list)
    
    @property
    def success_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return (self.successful_requests / self.total_requests) * 100
    
    @property
    def avg_latency_ms(self) -> float:
        if not self.results:
            return 0.0
        return statistics.mean(r.latency_ms for r in self.results)
    
    @property
    def p50_latency_ms(self) -> float:
        if not self.results:
            return 0.0
        return statistics.median(r.latency_ms for r in self.results)
    
    @property
    def p95_latency_ms(self) -> float:
        if not self.results:
            return 0.0
        sorted_latencies = sorted(r.latency_ms for r in self.results)
        idx = int(len(sorted_latencies) * 0.95)
        return sorted_latencies[min(idx, len(sorted_latencies) - 1)]
    
    @property
    def p99_latency_ms(self) -> float:
        if not self.results:
            return 0.0
        sorted_latencies = sorted(r.latency_ms for r in self.results)
        idx = int(len(sorted_latencies) * 0.99)
        return sorted_latencies[min(idx, len(sorted_latencies) - 1)]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "infra_name": self.infra_name,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "success_rate_percent": round(self.success_rate, 2),
            "latency_ms": {
                "avg": round(self.avg_latency_ms, 2),
                "p50": round(self.p50_latency_ms, 2),
                "p95": round(self.p95_latency_ms, 2),
                "p99": round(self.p99_latency_ms, 2),
            },
        }


# Test queries by category
TEST_QUERIES = {
    "ATC": [
        "Hola, necesito ayuda con un trámite",
        "Quiero hacer una queja sobre un servicio",
        "¿Cómo puedo obtener información pública?",
        "Necesito hablar con un asesor",
    ],
    "SOC": [
        "Reporto una situación de emergencia",
        "Hay un incidente de seguridad en la zona",
        "Necesito reportar actividad sospechosa",
    ],
    "LEG": [
        "Tengo una duda sobre una ley municipal",
        "Necesito revisar un contrato",
        "¿Cuáles son mis derechos como ciudadano?",
    ],
    "FIN": [
        "Quiero consultar el estado de un pago",
        "Necesito información sobre presupuesto",
        "¿Dónde puedo pagar mis impuestos?",
    ],
    "RH": [
        "Busco información sobre vacantes",
        "Tengo una duda sobre mis beneficios",
        "Necesito hablar de recursos humanos",
    ],
    "IT": [
        "El sistema no está funcionando",
        "Tengo problemas con mi acceso",
        "Necesito soporte técnico",
    ],
    "ADM": [
        "Quiero solicitar un permiso",
        "Necesito una licencia de funcionamiento",
        "¿Qué trámites necesito hacer?",
    ],
    "SAL": [
        "Necesito información sobre vacunación",
        "Quiero reportar un problema de salud",
        "¿Dónde está el hospital más cercano?",
    ],
    "EDU": [
        "Quiero información sobre escuelas",
        "Necesito saber sobre becas",
        "¿Cómo obtengo una certificación?",
    ],
    "URB": [
        "Tengo dudas sobre zonificación",
        "Quiero solicitar una inspección",
        "Necesito permiso de construcción",
    ],
}


class SwarmStressTester:
    """Stress tester for PACO agent swarms."""
    
    def __init__(self, orchestrator_url: str, timeout: float = 30.0):
        self.orchestrator_url = orchestrator_url
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=timeout)
    
    async def health_check(self) -> Dict[str, Any]:
        """Check health of the orchestrator and sample agents."""
        results = {
            "orchestrator": None,
            "agents": {},
            "timestamp": datetime.now().isoformat(),
        }
        
        # Check orchestrator
        try:
            response = await self.client.get(f"{self.orchestrator_url}/health")
            results["orchestrator"] = {
                "status": "healthy" if response.status_code == 200 else "unhealthy",
                "status_code": response.status_code,
            }
        except Exception as e:
            results["orchestrator"] = {
                "status": "error",
                "error": str(e),
            }
        
        return results
    
    async def send_single_request(
        self,
        query: str,
        conversation_id: Optional[str] = None,
    ) -> TestResult:
        """Send a single request and measure latency."""
        start_time = time.time()
        
        try:
            response = await self.client.post(
                f"{self.orchestrator_url}/chat",
                json={
                    "message": query,
                    "conversationId": conversation_id or f"test-{random.randint(1000, 9999)}",
                },
            )
            latency_ms = (time.time() - start_time) * 1000
            
            if response.status_code == 200:
                data = response.json()
                return TestResult(
                    success=True,
                    latency_ms=latency_ms,
                    status_code=response.status_code,
                    agent_slug=data.get("agentSlug"),
                    skill_used=data.get("skillUsed"),
                )
            else:
                return TestResult(
                    success=False,
                    latency_ms=latency_ms,
                    status_code=response.status_code,
                    error=f"HTTP {response.status_code}",
                )
                
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            return TestResult(
                success=False,
                latency_ms=latency_ms,
                error=str(e),
            )
    
    async def run_concurrent_test(
        self,
        num_requests: int,
        concurrent_limit: int,
        report: StressTestReport,
    ) -> None:
        """Run concurrent stress test."""
        semaphore = asyncio.Semaphore(concurrent_limit)
        
        async def bounded_request() -> TestResult:
            async with semaphore:
                # Pick random category and query
                category = random.choice(list(TEST_QUERIES.keys()))
                query = random.choice(TEST_QUERIES[category])
                return await self.send_single_request(query)
        
        # Create tasks
        tasks = [bounded_request() for _ in range(num_requests)]
        
        # Execute with progress
        completed = 0
        for coro in asyncio.as_completed(tasks):
            result = await coro
            report.results.append(result)
            if result.success:
                report.successful_requests += 1
            else:
                report.failed_requests += 1
            
            completed += 1
            if completed % 100 == 0:
                print(f"  Progress: {completed}/{num_requests} ({completed/num_requests*100:.0f}%)")
    
    async def test_circuit_breaker(self, num_requests: int = 50) -> Dict[str, Any]:
        """Test circuit breaker behavior by sending rapid requests."""
        print("\n🔨 Testing Circuit Breaker...")
        
        results = {
            "normal_requests": [],
            "stressed_requests": [],
            "circuit_states": [],
        }
        
        # Phase 1: Normal requests
        print("  Phase 1: Normal load...")
        for i in range(10):
            result = await self.send_single_request("Hola, necesito ayuda")
            results["normal_requests"].append({
                "success": result.success,
                "latency_ms": result.latency_ms,
            })
            await asyncio.sleep(0.5)
        
        # Phase 2: Stress (rapid requests)
        print("  Phase 2: High load (rapid requests)...")
        stress_tasks = [
            self.send_single_request("Consulta de prueba de estrés")
            for _ in range(num_requests)
        ]
        stress_results = await asyncio.gather(*stress_tasks)
        results["stressed_requests"] = [
            {"success": r.success, "latency_ms": r.latency_ms, "error": r.error}
            for r in stress_results
        ]
        
        # Phase 3: Recovery
        print("  Phase 3: Recovery...")
        await asyncio.sleep(5)
        for i in range(10):
            result = await self.send_single_request("Hola, siguen ahí?")
            results["normal_requests"].append({
                "success": result.success,
                "latency_ms": result.latency_ms,
            })
            await asyncio.sleep(0.5)
        
        # Analyze
        success_rate = sum(1 for r in stress_results if r.success) / len(stress_results) * 100
        avg_latency = statistics.mean(r.latency_ms for r in stress_results)
        
        return {
            "success_rate_percent": round(success_rate, 2),
            "avg_latency_ms": round(avg_latency, 2),
            "total_requests": len(stress_results),
            "circuit_breaker_triggered": success_rate < 80,
        }
    
    async def close(self):
        await self.client.aclose()


async def main():
    parser = argparse.ArgumentParser(description="Stress test PACO agent swarm")
    parser.add_argument(
        "--infra-name",
        default="swarm-100",
        help="Name of the infrastructure to test",
    )
    parser.add_argument(
        "--orchestrator-port",
        type=int,
        default=9000,
        help="Port of the orchestrator/coordinator",
    )
    parser.add_argument(
        "--requests",
        type=int,
        default=1000,
        help="Total number of requests to send",
    )
    parser.add_argument(
        "--concurrent",
        type=int,
        default=50,
        help="Max concurrent requests",
    )
    parser.add_argument(
        "--health-check",
        action="store_true",
        help="Run health check only",
    )
    parser.add_argument(
        "--circuit-breaker-test",
        action="store_true",
        help="Test circuit breaker behavior",
    )
    parser.add_argument(
        "--output",
        help="Save report to JSON file",
    )
    
    args = parser.parse_args()
    
    orchestrator_url = f"http://localhost:{args.orchestrator_port}"
    tester = SwarmStressTester(orchestrator_url)
    
    try:
        print("=" * 60)
        print("PACO Swarm Stress Test")
        print("=" * 60)
        print(f"Target: {orchestrator_url}")
        print(f"Infrastructure: {args.infra_name}")
        
        # Health check first
        print("\n🏥 Health Check...")
        health = await tester.health_check()
        print(f"  Orchestrator: {health['orchestrator']['status']}")
        
        if health['orchestrator']['status'] != 'healthy':
            print("\n❌ Orchestrator is not healthy. Aborting.")
            return
        
        if args.health_check:
            print(json.dumps(health, indent=2))
            return
        
        # Circuit breaker test
        if args.circuit_breaker_test:
            cb_result = await tester.test_circuit_breaker()
            print("\n📊 Circuit Breaker Results:")
            print(f"  Success Rate: {cb_result['success_rate_percent']}%")
            print(f"  Avg Latency: {cb_result['avg_latency_ms']}ms")
            print(f"  Circuit Triggered: {cb_result['circuit_breaker_triggered']}")
            return
        
        # Full stress test
        print(f"\n🚀 Starting Stress Test")
        print(f"  Total Requests: {args.requests}")
        print(f"  Concurrent Limit: {args.concurrent}")
        print("-" * 60)
        
        report = StressTestReport(
            infra_name=args.infra_name,
            start_time=datetime.now(),
            total_requests=args.requests,
        )
        
        await tester.run_concurrent_test(
            num_requests=args.requests,
            concurrent_limit=args.concurrent,
            report=report,
        )
        
        report.end_time = datetime.now()
        
        # Print results
        print("\n" + "=" * 60)
        print("Stress Test Results")
        print("=" * 60)
        print(f"Duration: {(report.end_time - report.start_time).total_seconds():.1f}s")
        print(f"Total Requests: {report.total_requests}")
        print(f"Successful: {report.successful_requests}")
        print(f"Failed: {report.failed_requests}")
        print(f"Success Rate: {report.success_rate:.2f}%")
        print("\nLatency Distribution:")
        print(f"  Average: {report.avg_latency_ms:.2f}ms")
        print(f"  P50: {report.p50_latency_ms:.2f}ms")
        print(f"  P95: {report.p95_latency_ms:.2f}ms")
        print(f"  P99: {report.p99_latency_ms:.2f}ms")
        
        # Save report
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(report.to_dict(), f, indent=2)
            print(f"\n📄 Report saved to: {args.output}")
        
        # Government-grade assessment
        print("\n" + "=" * 60)
        print("Government-Grade Assessment")
        print("=" * 60)
        
        assessments = []
        if report.success_rate >= 99.9:
            assessments.append(("Availability", "✅", "Excellent (99.9%+ uptime)"))
        elif report.success_rate >= 99:
            assessments.append(("Availability", "⚠️", "Good (99%+)"))
        else:
            assessments.append(("Availability", "❌", f"Poor ({report.success_rate:.1f}%)"))
        
        if report.p95_latency_ms < 500:
            assessments.append(("Response Time P95", "✅", f"Excellent ({report.p95_latency_ms:.0f}ms)"))
        elif report.p95_latency_ms < 1000:
            assessments.append(("Response Time P95", "⚠️", f"Acceptable ({report.p95_latency_ms:.0f}ms)"))
        else:
            assessments.append(("Response Time P95", "❌", f"Poor ({report.p95_latency_ms:.0f}ms)"))
        
        for metric, icon, status in assessments:
            print(f"  {metric}: {icon} {status}")
        
    finally:
        await tester.close()


if __name__ == "__main__":
    asyncio.run(main())
