#!/usr/bin/env python3
"""
PACO Swarm Deployment - 100 Agents
====================================

Deploys a swarm of 100 agents using PACO's infrastructure-as-code capabilities.
Supports both orchestrator and hive (coordinator-worker) patterns.

Usage:
    python swarm_deploy_100.py --mode orchestrator --infra-name swarm-100
    python swarm_deploy_100.py --mode hive --infra-name hive-swarm-100
    python swarm_deploy_100.py --cleanup --infra-name swarm-100

Government-Grade Features:
- Distributed tracing with OpenTelemetry
- Circuit breaker patterns for resilience
- Health checks and auto-recovery
- Audit logging
- Resource quotas and limits
"""

import argparse
import asyncio
import random
import string
from datetime import datetime
from typing import List, Dict, Any, Optional
from uuid import uuid4

import httpx
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

# Add backend to path
import sys
from pathlib importPath
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.db.session import async_session_maker
from app.db.models import Infrastructure, InfraAgent, InfraOrchestrator, HiveCoordinator, InfraDeployment
from app.services.infra_generator import InfraGenerator
from app.services.docker_manager import DockerManager


# =============================================================================
# Configuration
# =============================================================================

AGENT_CATEGORIES = [
    ("ATC", "Atención al Ciudadano", ["general_inquiry", "complaint", "suggestion"]),
    ("SOC", "Seguridad Operacional", ["threat_analysis", "incident_response", "monitoring"]),
    ("LEG", "Asesoría Legal", ["legal_consultation", "document_review", "compliance"]),
    ("FIN", "Finanzas", ["budget_inquiry", "payment_processing", "audit"]),
    ("RH", "Recursos Humanos", ["personnel_inquiry", "benefits", "recruitment"]),
    ("IT", "Tecnología", ["support_ticket", "infrastructure", "security"]),
    ("ADM", "Administración", ["permits", "licenses", "records"]),
    ("SAL", "Salud Pública", ["health_inquiry", "epidemiology", "vaccination"]),
    ("EDU", "Educación", ["school_inquiry", "scholarships", "certifications"]),
    ("URB", "Urbanismo", ["zoning", "construction", "inspections"]),
]

SWARM_CONFIG = {
    "orchestrator": {
        "port_range_start": 9000,
        "classification_model": "claude-sonnet-4-5-20250929",
        "classification_temperature": 0.1,
        "agent_timeout": 30.0,
        "circuit_breaker_failure_threshold": 5,
        "circuit_breaker_recovery_timeout": 30,
    },
    "hive": {
        "port_range_start": 10000,
        "coordinator_model": "claude-sonnet-4-5-20250929",
        "coordinator_temperature": 0.1,
        "max_concurrent_tasks": 20,
        "task_timeout": 300,
        "max_retries": 3,
        "aggregation_strategy": "hierarchical",
    },
}


# =============================================================================
# Helper Functions
# =============================================================================

def generate_agent_config(
    index: int,
    category_code: str,
    category_name: str,
    task_types: List[str],
    infra_id: str,
) -> Dict[str, Any]:
    """Generate configuration for a single agent in the swarm."""
    agent_slug = f"{category_code.lower()}-{index:03d}"
    
    # Generate system prompts based on category
    system_prompts = {
        "main": f"""Eres un agente especializado de {category_name} del gobierno.
Tu código de agente es {agent_slug}.

MISIÓN:
- Proporcionar atención ciudadana eficiente y precisa
- Escalar casos complejos a supervisores humanos
- Mantener registros auditables de todas las interacciones

RESTRICCIONES:
- No compartas información personal de ciudadanos sin autorización
- Respeta los protocolos de confidencialidad del nivel {{confidentiality_level}}
- En caso de duda, consulta con un supervisor""",
        
        "classification": f"Clasifica la consulta como uno de: {', '.join(task_types)}",
        
        "escalation": "Escalar a supervisor humano cuando: datos sensibles, situaciones de riesgo, o cuando el ciudadano lo solicite.",
    }
    
    # Generate keywords for routing
    keywords = {
        "ATC": ["ayuda", "pregunta", "información", "consulta"],
        "SOC": ["emergencia", "seguridad", "amenaza", "riesgo"],
        "LEG": ["legal", "ley", "normativa", "derecho", "contrato"],
        "FIN": ["pago", "presupuesto", "factura", "dinero"],
        "RH": ["empleado", "trabajo", "nómina", "beneficio"],
        "IT": ["sistema", "computadora", "error", "técnico"],
        "ADM": ["permiso", "licencia", "trámite", "documento"],
        "SAL": ["salud", "médico", "hospital", "vacuna"],
        "EDU": ["escuela", "estudio", "beca", "calificación"],
        "URB": ["construcción", "zona", "terreno", "inspección"],
    }.get(category_code, ["general"])
    
    return {
        "agent_id_slug": agent_slug,
        "display_name": f"{category_name} Agent {index:03d}",
        "description": f"Specialized agent for {category_name} operations - Instance {index:03d}",
        "category_code": category_code,
        "system_prompts": system_prompts,
        "tools_config": [
            {"name": "search_knowledge_base", "required": True},
            {"name": "create_ticket", "required": True},
            {"name": "escalate_to_human", "required": True},
            {"name": "log_interaction", "required": True},
        ],
        "task_types": task_types,
        "keywords": keywords,
        "confidentiality_level": "CONFIDENTIAL" if category_code in ["SOC", "LEG", "FIN"] else "INTERNAL",
        "capabilities": {
            "languages": ["es", "en"],
            "channels": ["web", "mobile", "whatsapp"],
            "max_concurrent_sessions": 50,
            "requires_human_oversight": category_code in ["SOC", "LEG"],
        },
    }


async def create_infrastructure(
    name: str,
    mode: str,
    display_name: str,
    description: str,
) -> Infrastructure:
    """Create the infrastructure record in the database."""
    async with async_session_maker() as db:
        # Check if exists
        result = await db.execute(
            select(Infrastructure).where(Infrastructure.name == name)
        )
        existing = result.scalar_one_or_none()
        if existing:
            print(f"Infrastructure '{name}' already exists. Using existing.")
            return existing
        
        config = SWARM_CONFIG[mode]
        
        infra = Infrastructure(
            name=name,
            display_name=display_name,
            description=description,
            type=mode,
            status="draft",
            port_range_start=config["port_range_start"],
            env_config={
                "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
                "LOG_LEVEL": "INFO",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "${OTEL_ENDPOINT}",
            },
            security_config={
                "enable_audit_log": True,
                "encryption_at_rest": True,
                "require_mfa": False,
                "session_timeout_minutes": 30,
            },
            db_name=name.lower().replace("-", "_"),
            redis_config={
                "host": "redis",
                "port": 6379,
                "db": 0,
            },
            lightning_config={
                "enabled": True,
                "store_type": "postgres",
                "enable_store_server": True,
                "store_server_port": 4318,
                "auto_rewards": True,
                "feedback_endpoint": True,
                "training_scaffolding": True,
            },
        )
        db.add(infra)
        await db.commit()
        await db.refresh(infra)
        
        # Create orchestrator or coordinator
        if mode == "orchestrator":
            orchestrator = InfraOrchestrator(
                infrastructure_id=infra.id,
                classification_model=config["classification_model"],
                classification_temperature=config["classification_temperature"],
                keyword_map={cat[0]: cat[2] for cat in AGENT_CATEGORIES},
                classification_prompt=None,  # Use default
                fallback_agent="atc-000",
                agent_timeout=config["agent_timeout"],
                circuit_breaker_config={
                    "failure_threshold": config["circuit_breaker_failure_threshold"],
                    "recovery_timeout": config["circuit_breaker_recovery_timeout"],
                    "half_open_max_calls": 3,
                },
                status="stopped",
            )
            db.add(orchestrator)
        else:  # hive
            coordinator = HiveCoordinator(
                infrastructure_id=infra.id,
                coordinator_model=config["coordinator_model"],
                coordinator_temperature=config["coordinator_temperature"],
                decomposition_prompt=None,  # Use default
                max_concurrent_tasks=config["max_concurrent_tasks"],
                task_timeout=config["task_timeout"],
                max_retries=config["max_retries"],
                aggregation_strategy=config["aggregation_strategy"],
                aggregation_prompt=None,
                plan_mode_enabled=True,
                status="stopped",
            )
            db.add(coordinator)
        
        await db.commit()
        return infra


async def create_agents(infra_id: str, count: int = 100) -> List[InfraAgent]:
    """Create agent records for the swarm."""
    async with async_session_maker() as db:
        agents = []
        
        for i in range(count):
            # Distribute agents across categories
            category = AGENT_CATEGORIES[i % len(AGENT_CATEGORIES)]
            category_code, category_name, task_types = category
            
            config = generate_agent_config(i, category_code, category_name, task_types, infra_id)
            
            agent = InfraAgent(
                infrastructure_id=infra_id,
                agent_id_slug=config["agent_id_slug"],
                display_name=config["display_name"],
                description=config["description"],
                category_code=config["category_code"],
                system_prompts=config["system_prompts"],
                tools_config=config["tools_config"],
                task_types=config["task_types"],
                keywords=config["keywords"],
                confidentiality_level=config["confidentiality_level"],
                capabilities=config["capabilities"],
                port=None,  # Will be assigned by infrastructure generator
                version="1.0.0",
                status="stopped",
            )
            db.add(agent)
            agents.append(agent)
            
            if (i + 1) % 10 == 0:
                print(f"  Created {i + 1}/{count} agents...")
        
        await db.commit()
        
        # Refresh all agents to get their IDs
        for agent in agents:
            await db.refresh(agent)
        
        return agents


async def generate_infrastructure_code(infra_id: str) -> Dict[str, Any]:
    """Generate the infrastructure code using the InfraGenerator."""
    generator = InfraGenerator()
    result = await generator.generate(infra_id)
    return {
        "success": result.success,
        "project_path": result.project_path,
        "files_generated": len(result.files_generated),
        "error": result.error,
    }


async def deploy_infrastructure(infra_id: str) -> Dict[str, Any]:
    """Deploy the infrastructure using Docker."""
    docker = DockerManager()
    
    async with async_session_maker() as db:
        result = await db.execute(
            select(Infrastructure).where(Infrastructure.id == infra_id)
        )
        infra = result.scalar_one()
        
        if not infra.project_path:
            return {"success": False, "error": "Infrastructure not generated"}
        
        # Deploy
        deploy_result = await docker.up(infra.project_path)
        
        # Update status
        if deploy_result["success"]:
            infra.status = "running"
        else:
            infra.status = "error"
        
        await db.commit()
        return deploy_result


async def get_swarm_status(infra_id: str) -> Dict[str, Any]:
    """Get the status of the swarm deployment."""
    async with async_session_maker() as db:
        result = await db.execute(
            select(Infrastructure)
            .where(Infrastructure.id == infra_id)
            .options(
                selectinload(Infrastructure.agents),
                selectinload(Infrastructure.orchestrator),
                selectinload(Infrastructure.hive_coordinator),
            )
        )
        infra = result.scalar_one_or_none()
        
        if not infra:
            return {"error": "Infrastructure not found"}
        
        # Group agents by category
        agents_by_category = {}
        for agent in infra.agents:
            cat = agent.category_code
            if cat not in agents_by_category:
                agents_by_category[cat] = []
            agents_by_category[cat].append({
                "slug": agent.agent_id_slug,
                "status": agent.status,
                "port": agent.port,
            })
        
        return {
            "infrastructure": {
                "id": str(infra.id),
                "name": infra.name,
                "type": infra.type,
                "status": infra.status,
                "project_path": infra.project_path,
                "port_range_start": infra.port_range_start,
            },
            "agents": {
                "total": len(infra.agents),
                "by_category": {
                    cat: len(agents) for cat, agents in agents_by_category.items()
                },
                "sample": [
                    {"slug": a.agent_id_slug, "status": a.status}
                    for a in infra.agents[:5]
                ],
            },
            "control_plane": {
                "orchestrator_status": infra.orchestrator.status if infra.orchestrator else None,
                "coordinator_status": infra.hive_coordinator.status if infra.hive_coordinator else None,
            },
        }


async def cleanup_infrastructure(name: str) -> Dict[str, Any]:
    """Clean up (stop and remove) an infrastructure."""
    async with async_session_maker() as db:
        result = await db.execute(
            select(Infrastructure).where(Infrastructure.name == name)
        )
        infra = result.scalar_one_or_none()
        
        if not infra:
            return {"success": False, "error": f"Infrastructure '{name}' not found"}
        
        # Stop containers if running
        if infra.project_path:
            docker = DockerManager()
            await docker.down(infra.project_path)
        
        # Delete from database (cascade will handle related records)
        await db.delete(infra)
        await db.commit()
        
        return {"success": True, "message": f"Infrastructure '{name}' cleaned up"}


# =============================================================================
# Main Entry Point
# =============================================================================

async def main():
    parser = argparse.ArgumentParser(
        description="Deploy a swarm of 100 agents using PACO"
    )
    parser.add_argument(
        "--mode",
        choices=["orchestrator", "hive"],
        default="orchestrator",
        help="Deployment mode: orchestrator (router-based) or hive (coordinator-worker)",
    )
    parser.add_argument(
        "--infra-name",
        default=f"swarm-100-{datetime.now().strftime('%Y%m%d')}",
        help="Name for the infrastructure",
    )
    parser.add_argument(
        "--agent-count",
        type=int,
        default=100,
        help="Number of agents to deploy (default: 100)",
    )
    parser.add_argument(
        "--skip-generate",
        action="store_true",
        help="Skip code generation (use existing)",
    )
    parser.add_argument(
        "--skip-deploy",
        action="store_true",
        help="Skip deployment (only generate code)",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show status of existing infrastructure",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Clean up (stop and remove) the infrastructure",
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("PACO Swarm Deployment - 100 Agents")
    print("=" * 60)
    print(f"Mode: {args.mode}")
    print(f"Infrastructure: {args.infra_name}")
    print(f"Agent Count: {args.agent_count}")
    print("-" * 60)
    
    if args.cleanup:
        print("\n🧹 Cleaning up infrastructure...")
        result = await cleanup_infrastructure(args.infra_name)
        print(f"Result: {result}")
        return
    
    # Create infrastructure
    print("\n🏗️  Creating infrastructure...")
    infra = await create_infrastructure(
        name=args.infra_name,
        mode=args.mode,
        display_name=f"Swarm 100 - {args.mode.title()} Mode",
        description=f"100-agent swarm deployment using {args.mode} pattern",
    )
    print(f"  Infrastructure ID: {infra.id}")
    print(f"  Type: {infra.type}")
    
    # Create agents
    print(f"\n🤖 Creating {args.agent_count} agents...")
    agents = await create_agents(str(infra.id), args.agent_count)
    print(f"  Created {len(agents)} agents")
    
    # Generate code
    if not args.skip_generate:
        print("\n📦 Generating infrastructure code...")
        gen_result = await generate_infrastructure_code(str(infra.id))
        if gen_result["success"]:
            print(f"  Generated {gen_result['files_generated']} files")
            print(f"  Project path: {gen_result['project_path']}")
        else:
            print(f"  ❌ Generation failed: {gen_result['error']}")
            return
    
    # Deploy
    if not args.skip_deploy and not args.skip_generate:
        print("\n🚀 Deploying infrastructure...")
        deploy_result = await deploy_infrastructure(str(infra.id))
        if deploy_result["success"]:
            print("  ✅ Deployment successful")
        else:
            print(f"  ❌ Deployment failed: {deploy_result.get('error', 'Unknown error')}")
    
    # Show status
    print("\n📊 Swarm Status:")
    status = await get_swarm_status(str(infra.id))
    print(f"  Infrastructure: {status['infrastructure']['name']}")
    print(f"  Status: {status['infrastructure']['status']}")
    print(f"  Total Agents: {status['agents']['total']}")
    print(f"  Distribution by Category:")
    for cat, count in status['agents']['by_category'].items():
        print(f"    - {cat}: {count} agents")
    
    print("\n" + "=" * 60)
    print("Swarm deployment complete!")
    print("=" * 60)
    print(f"\nAccess Points:")
    print(f"  - Orchestrator/Coordinator: http://localhost:{infra.port_range_start}")
    print(f"  - Agent ports: {infra.port_range_start + 1} - {infra.port_range_start + args.agent_count}")
    print(f"\nManagement Commands:")
    print(f"  cd {infra.project_path}")
    print(f"  docker-compose logs -f")
    print(f"  docker-compose ps")


if __name__ == "__main__":
    asyncio.run(main())
